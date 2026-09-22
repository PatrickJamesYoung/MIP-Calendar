/**
 * POST /api/daybook/send
 *
 * Final step. Refuses to send unless:
 *   - The run's status is 'rendered' (validation passed)
 *   - The daybook_sends UNIQUE constraint accepts the insert
 *
 * Order of operations is critical: we INSERT into daybook_sends FIRST
 * (grabbing the UNIQUE slot) and only then call Buttondown. If Buttondown
 * fails, we mark the send row with a null buttondown_email_id and mark
 * the run failed; a manual replay of the same (date, edition) is blocked
 * by the UNIQUE constraint and must be released explicitly.
 *
 * This ordering makes duplicate sends impossible even under race.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/daybook/auth";

const Body = z.object({ run_id: z.string().uuid() });

export async function POST(req: Request) {
  const guard = checkBearer(req);
  if (guard) return guard;

  const { run_id } = Body.parse(await req.json());
  const supabase = createAdminClient();

  const { data: run } = await supabase
    .from("daybook_runs")
    .select("id, publication_date, edition, status")
    .eq("id", run_id)
    .single();
  if (!run) return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  if (run.status !== "rendered") {
    return NextResponse.json({ error: "not_rendered", status: run.status }, { status: 409 });
  }

  const { data: draft } = await supabase
    .from("daybook_drafts")
    .select("rendered_html, subject, validation_report")
    .eq("run_id", run_id)
    .single();
  if (!draft) return NextResponse.json({ error: "draft_missing" }, { status: 404 });

  const report = draft.validation_report as { passed: boolean };
  if (!report?.passed) {
    return NextResponse.json({ error: "validation_not_passed" }, { status: 409 });
  }

  // Grab the UNIQUE slot BEFORE calling Buttondown. This is the safety.
  const { data: sendRow, error: sendErr } = await supabase
    .from("daybook_sends")
    .insert({
      run_id,
      publication_date: run.publication_date,
      edition: run.edition,
    })
    .select("id")
    .single();
  if (sendErr) {
    // Unique violation = someone already sent for this (date, edition).
    if ((sendErr as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "already_sent" }, { status: 409 });
    }
    return NextResponse.json({ error: "db_error", detail: sendErr.message }, { status: 500 });
  }

  // Buttondown send.
  const btResp = await postToButtondown({
    subject: draft.subject,
    html: draft.rendered_html,
  });
  if (!btResp.ok) {
    await supabase
      .from("daybook_runs")
      .update({
        status: "failed",
        error: `buttondown_send_failed:${btResp.error}`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run_id);
    return NextResponse.json({ error: "buttondown_failed", detail: btResp.error }, { status: 502 });
  }

  await supabase
    .from("daybook_sends")
    .update({
      buttondown_email_id: btResp.email_id,
      archive_url: btResp.archive_url,
    })
    .eq("id", sendRow.id);

  await supabase
    .from("daybook_runs")
    .update({ status: "sent" })
    .eq("id", run_id);

  return NextResponse.json({ ok: true, archive_url: btResp.archive_url });
}

async function postToButtondown(args: { subject: string; html: string }): Promise<
  | { ok: true; email_id: string; archive_url: string }
  | { ok: false; error: string }
> {
  const key = process.env.BUTTONDOWN_API_KEY;
  if (!key) return { ok: false, error: "missing_BUTTONDOWN_API_KEY" };

  try {
    const r = await fetch("https://api.buttondown.email/v1/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${key}`,
      },
      body: JSON.stringify({
        subject: args.subject,
        body: args.html,
        email_type: "public",
        status: "about_to_send",
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      return { ok: false, error: `${r.status}:${text.slice(0, 400)}` };
    }
    const j = (await r.json()) as { id?: string; absolute_url?: string };
    if (!j.id) return { ok: false, error: "buttondown_missing_id" };
    return { ok: true, email_id: j.id, archive_url: j.absolute_url ?? "" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

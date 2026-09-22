/**
 * POST /api/daybook/alert
 *
 * Failure alert channel. Called by the workflow's `if: failure()` step
 * and by the server routes when they mark a run failed/blocked. Sends
 * an email via Resend to ADMIN_NOTIFY_EMAILS and (optionally) writes a
 * row into the "Daybook Ops" Notion database if configured.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { checkBearer } from "@/lib/daybook/auth";
import { resendSend } from "@/lib/email/resend-client";

const Body = z.object({
  run_id: z.string().uuid(),
  reason: z.string(),
  run_url: z.string().url().optional(),
});

export async function POST(req: Request) {
  const guard = checkBearer(req);
  if (guard) return guard;

  const { run_id, reason, run_url } = Body.parse(await req.json());
  const to = (process.env.ADMIN_NOTIFY_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (to.length === 0) {
    return NextResponse.json({ ok: false, error: "no_recipients" }, { status: 200 });
  }

  const subject = `[Daybook] Run failed — ${reason}`;
  const html = `<p>Run <code>${run_id}</code> failed.</p><p>Reason: <code>${reason}</code></p>${
    run_url ? `<p><a href="${run_url}">GitHub Actions run</a></p>` : ""
  }`;
  const text = `Run ${run_id} failed. Reason: ${reason}. ${run_url ?? ""}`;

  const res = await resendSend({
    from: process.env.EMAIL_FROM ?? "MIP Calendar <onboarding@resend.dev>",
    to,
    subject,
    html,
    text,
  });

  return NextResponse.json({ ok: res.ok, error: res.error });
}

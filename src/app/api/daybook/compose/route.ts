/**
 * POST /api/daybook/compose
 *
 * Reads all sources for a run, enforces hard-source and at-least-one-of
 * requirements, calls the LLM to compose the briefing, validates the
 * output against DaybookComposition, renders HTML, runs pre-send
 * validation, and stores everything in daybook_drafts.
 *
 * Does NOT send. Sending happens in /api/daybook/send after this route
 * returns run status='rendered'.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/daybook/auth";
import {
  DaybookComposition,
  HARD_REQUIRED_SOURCES,
  AT_LEAST_ONE_OF,
  type SourceKey,
} from "@/lib/daybook/types";
import { renderEmailHtml } from "@/lib/daybook/render";
import { validateDraft } from "@/lib/daybook/validation";
import { composeWithLlm } from "@/lib/daybook/compose";

const Body = z.object({ run_id: z.string().uuid() });

export async function POST(req: Request) {
  const guard = checkBearer(req);
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { run_id } = parsed.data;

  const supabase = createAdminClient();

  const { data: run, error: runErr } = await supabase
    .from("daybook_runs")
    .select("id, publication_date, edition, status")
    .eq("id", run_id)
    .single();
  if (runErr || !run) {
    return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  }

  const { data: sources, error: srcErr } = await supabase
    .from("daybook_sources")
    .select("source_key, ok, payload, error")
    .eq("run_id", run_id);
  if (srcErr) {
    return NextResponse.json({ error: "db_error", detail: srcErr.message }, { status: 500 });
  }

  const bySource = new Map<SourceKey, { ok: boolean; payload: unknown }>();
  for (const s of sources ?? []) {
    bySource.set(s.source_key as SourceKey, { ok: s.ok, payload: s.payload });
  }

  // Enforce hard requirements before spending LLM tokens.
  for (const key of HARD_REQUIRED_SOURCES) {
    if (!bySource.get(key)?.ok) {
      await markFailed(supabase, run_id, `hard_source_failed:${key}`);
      return NextResponse.json({ error: "hard_source_failed", key }, { status: 422 });
    }
  }
  for (const group of AT_LEAST_ONE_OF) {
    if (!group.some((k) => bySource.get(k)?.ok)) {
      await markFailed(supabase, run_id, `at_least_one_of_failed:${group.join("|")}`);
      return NextResponse.json({ error: "at_least_one_of_failed", group }, { status: 422 });
    }
  }

  await supabase.from("daybook_runs").update({ status: "fetched" }).eq("id", run_id);

  // LLM composition. Uses the AI SDK — provider swappable via env.
  const composition = await composeWithLlm({
    publication_date: run.publication_date,
    edition: run.edition,
    sources: Object.fromEntries(
      Array.from(bySource.entries()).map(([k, v]) => [k, v.ok ? v.payload : null]),
    ),
  });

  const parsedComp = DaybookComposition.safeParse(composition.json);
  if (!parsedComp.success) {
    await markFailed(supabase, run_id, `composition_schema_invalid:${parsedComp.error.message.slice(0, 200)}`);
    return NextResponse.json({ error: "composition_invalid", detail: parsedComp.error.flatten() }, { status: 422 });
  }

  await supabase.from("daybook_runs").update({ status: "composed" }).eq("id", run_id);

  const html = renderEmailHtml(parsedComp.data);
  const subject = parsedComp.data.subject;

  // Pre-send validation. NEVER skip this.
  const archiveUrl = buildArchiveUrl(parsedComp.data);
  const archiveResolves = await headOk(archiveUrl);
  const mip = (bySource.get("mip_calendar")?.payload ?? {}) as { items?: unknown[] };
  const sourceCount = Array.isArray(mip.items) ? mip.items.length : 0;
  const report = validateDraft({
    composition: parsedComp.data,
    html,
    subject,
    archiveUrlResolves: archiveResolves,
    movementCalendarSourceCount: sourceCount,
  });

  const { error: draftErr } = await supabase.from("daybook_drafts").upsert(
    {
      run_id,
      composed_json: parsedComp.data,
      rendered_html: html,
      subject,
      validation_report: report,
      llm_model: composition.model,
      llm_tokens_in: composition.tokens_in,
      llm_tokens_out: composition.tokens_out,
    },
    { onConflict: "run_id" },
  );
  if (draftErr) {
    return NextResponse.json({ error: "db_error", detail: draftErr.message }, { status: 500 });
  }

  if (!report.passed) {
    await markBlocked(supabase, run_id, JSON.stringify(report.checks.filter((c) => !c.ok)));
    return NextResponse.json({ status: "blocked", report }, { status: 200 });
  }

  await supabase.from("daybook_runs").update({ status: "rendered" }).eq("id", run_id);
  return NextResponse.json({ status: "rendered", report });
}

async function markFailed(supabase: ReturnType<typeof createAdminClient>, run_id: string, error: string) {
  await supabase
    .from("daybook_runs")
    .update({ status: "failed", finished_at: new Date().toISOString(), error })
    .eq("id", run_id);
}

async function markBlocked(supabase: ReturnType<typeof createAdminClient>, run_id: string, error: string) {
  await supabase
    .from("daybook_runs")
    .update({ status: "blocked", finished_at: new Date().toISOString(), error })
    .eq("id", run_id);
}

function buildArchiveUrl(comp: DaybookComposition): string {
  // Buttondown archive URL pattern used by MIP.
  const kind = comp.edition === "weekly" ? "dc-weekly-planner" : "dc-daybook";
  return `https://buttondown.com/MovementInfrastructureProject/archive/${kind}-${comp.publication_date}/`;
}

async function headOk(_url: string): Promise<boolean> {
  // Pre-flight: at compose time the archive doesn't exist yet. We instead
  // check the publication home resolves. Real archive-URL validation happens
  // post-send in /api/daybook/send when Buttondown returns the archive_url.
  try {
    const r = await fetch("https://buttondown.com/MovementInfrastructureProject/", { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

// composeWithLlm lives in src/lib/daybook/compose.ts and calls the
// Perplexity Agent API with a JSON-schema `response_format` so the model
// output matches DaybookComposition. Temperature and provider config are
// in that module.

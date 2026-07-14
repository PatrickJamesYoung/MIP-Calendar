/**
 * POST /api/ingest/submissions
 *
 * Endpoint for the DC events GitHub Actions runner.
 *
 * Body shape:
 *   {
 *     "run_id": "gha-run-12345",              // optional GHA run identifier
 *     "runner_version": "runner.py@685-lines",// optional, stored on ingestion_runs
 *     "triggered_by": "github-actions",       // optional
 *     "events": [ RunnerEvent, ... ]          // full new_events.json array
 *   }
 *
 * Behavior:
 *   1. Creates a new `ingestion_runs` row (status='running').
 *   2. For each event with submit === "Submit":
 *        - Skips duplicates by (source, source_external_id).
 *        - Normalizes payload to submissions.event_payload shape.
 *        - Locks Movement Calendar overlay in.
 *        - Marks auto_submit=true if source is in the curated allow-list.
 *        - Inserts into `submissions` with status='pending'.
 *   3. Events with submit !== "Submit" are counted as skipped.
 *   4. Updates the ingestion_runs row with counts + status='success'.
 *
 * Idempotent: re-running the same run_id will not create duplicate
 * submissions, because the unique index on
 *   (source_type='ingest', source_name, source_external_id)
 * absorbs conflicts and we count them as skipped.
 *
 * Auth: bearer token.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { checkIngestAuth } from "@/lib/ingest/auth";
import { normalizeRunnerEvent, type RunnerEvent } from "@/lib/ingest/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * runner.py's `AUTO_SUBMIT_SOURCES` — curated sources whose events go
 * straight into the queue with the auto_submit flag on.
 */
const AUTO_SUBMIT_SOURCES = new Set([
  "Free DC",
  "Grassroots DC",
  "Rhizome DC",
  "Mobilize",
  "Festival Center",
]);

/**
 * Build a stable external_id for dedup. Prefer event_url (unique per source),
 * fall back to (source|title|date) hash.
 */
function externalIdFor(ev: RunnerEvent): string {
  if (ev.event_url && ev.event_url.trim()) {
    return ev.event_url.trim();
  }
  return `${ev.source}|${ev.title}|${ev.date}`.toLowerCase().replace(/\s+/g, " ").trim();
}

interface PostBody {
  run_id?: string;
  runner_version?: string;
  triggered_by?: string;
  events?: RunnerEvent[];
}

export async function POST(req: Request) {
  const auth = checkIngestAuth(req);
  if (!auth.ok) return auth.response;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const events = body.events;
  if (!Array.isArray(events)) {
    return Response.json(
      { error: "Body must include an 'events' array" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Look up the Movement Calendar overlay ID once.
  const { data: overlay } = await supabase
    .from("overlay_calendars")
    .select("id")
    .eq("slug", "movement")
    .maybeSingle();
  const movementOverlayId = overlay?.id ?? null;

  // Create the ingestion_runs row.
  const { data: runRow, error: runErr } = await supabase
    .from("ingestion_runs")
    .insert({
      status: "running",
      triggered_by: body.triggered_by ?? "github-actions",
      runner_version: body.runner_version ?? null,
      fetched_count: events.length,
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return Response.json(
      { error: `Could not create ingestion_runs row: ${runErr?.message ?? "unknown"}` },
      { status: 500 }
    );
  }
  const runId = runRow.id as string;

  // Aggregate counters.
  let submittedCount = 0;
  let skippedCount = 0;
  let autoSubmitCount = 0;
  const bySource: Record<
    string,
    { fetched: number; submitted: number; auto_submit: number; skipped: number; errors: number }
  > = {};

  const bump = (source: string, field: "fetched" | "submitted" | "auto_submit" | "skipped" | "errors") => {
    bySource[source] ??= { fetched: 0, submitted: 0, auto_submit: 0, skipped: 0, errors: 0 };
    bySource[source][field]++;
  };

  for (const ev of events) {
    bump(ev.source, "fetched");

    if (ev.submit !== "Submit") {
      skippedCount++;
      bump(ev.source, "skipped");
      continue;
    }

    let payload;
    try {
      payload = normalizeRunnerEvent(ev, movementOverlayId);
    } catch (e) {
      console.error("[ingest] normalize failed", ev, e);
      bump(ev.source, "errors");
      continue;
    }

    const isAutoSubmit = AUTO_SUBMIT_SOURCES.has(ev.source);
    const externalId = externalIdFor(ev);

    const { error: insertErr } = await supabase.from("submissions").insert({
      submitter_name: `${ev.source} (auto-ingested)`,
      submitter_email: "ingest@movementinfrastructureproject.org",
      submitter_phone: null,
      event_payload: payload,
      status: "pending",
      source_type: "ingest",
      source_name: ev.source,
      source_external_id: externalId,
      source_url: ev.event_url ?? null,
      auto_submit: isAutoSubmit,
      ip_address: null,
      user_agent: `runner.py via GitHub Actions (${body.runner_version ?? "unknown"})`,
    });

    if (insertErr) {
      // Unique index conflict = we already ingested this event. Count as skip.
      if (insertErr.code === "23505" || (insertErr.message ?? "").includes("duplicate")) {
        skippedCount++;
        bump(ev.source, "skipped");
        continue;
      }
      console.error("[ingest] insert failed", ev, insertErr);
      bump(ev.source, "errors");
      continue;
    }

    submittedCount++;
    bump(ev.source, "submitted");
    if (isAutoSubmit) {
      autoSubmitCount++;
      bump(ev.source, "auto_submit");
    }
  }

  const finishedAt = new Date().toISOString();
  const newCount = submittedCount + skippedCount; // rough — dedup already applied client-side
  await supabase
    .from("ingestion_runs")
    .update({
      finished_at: finishedAt,
      status: "success",
      new_count: newCount,
      submitted_count: submittedCount,
      skipped_count: skippedCount,
      auto_submit_count: autoSubmitCount,
      by_source: bySource,
    })
    .eq("id", runId);

  return Response.json({
    ok: true,
    run_id: runId,
    fetched_count: events.length,
    submitted_count: submittedCount,
    skipped_count: skippedCount,
    auto_submit_count: autoSubmitCount,
    by_source: bySource,
  });
}

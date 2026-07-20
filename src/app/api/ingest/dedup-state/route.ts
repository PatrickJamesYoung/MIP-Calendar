/**
 * GET /api/ingest/dedup-state
 *
 * Returns the union of every event we've seen — published events,
 * pending / approved / rejected / duplicate submissions (from any source),
 * and historical ingestion records seeded from the old Google-Sheets pipeline
 * — in the shape runner.py expects for `existing_rows.json`:
 *
 *   [[source, title, "M/D/YYYY", "H:MM AM"], ...]
 *
 * runner.py uses this to dedupe candidate events against everything the
 * calendar has ever known about. This endpoint replaces both the Google
 * Sheet read step and the Trumba cross-check with one call.
 *
 * Auth: bearer token (INGEST_BEARER_TOKEN env var, sent by GitHub Actions).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { checkIngestAuth } from "@/lib/ingest/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ET_TZ = "America/New_York";

function toEtDateAndTime(iso: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = dtf.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("month")}/${get("day")}/${get("year")}`;
  const hourStr = get("hour").replace(/^0/, "");
  const minute = get("minute");
  const dayPeriod = (get("dayPeriod") || "").toUpperCase();
  const time = hourStr && minute && dayPeriod ? `${hourStr}:${minute} ${dayPeriod}` : "";
  return { date, time };
}

export async function GET(req: Request) {
  const auth = checkIngestAuth(req);
  if (!auth.ok) return auth.response;

  const supabase = createAdminClient();

  // ---- 1. Published events -----------------------------------------------
  //
  // Only include events dated in the last 60 days through +365 days to keep
  // the response small (~5000 rows would still fit in a POST, but no reason).
  // runner.py filters to "date >= today ET" anyway; matching against past
  // events isn't useful.
  const nowIso = new Date().toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const { data: events, error: eventsErr } = await supabase
    .from("events")
    .select("title, starts_at, source, external_id")
    .gte("starts_at", sixtyDaysAgo)
    .limit(10000);
  if (eventsErr) {
    return Response.json({ error: `events query failed: ${eventsErr.message}` }, { status: 500 });
  }

  // ---- 2. Submissions -----------------------------------------------------
  //
  // Include every non-rejected, non-duplicate submission so we don't re-submit
  // something already queued or approved. event_payload is JSONB — we read
  // title + starts_at out of it.
  const { data: subs, error: subsErr } = await supabase
    .from("submissions")
    .select("event_payload, source_name, source_external_id, status")
    .in("status", ["pending", "approved", "needs_edit"])
    .gte("created_at", sixtyDaysAgo)
    .limit(10000);
  if (subsErr) {
    return Response.json({ error: `submissions query failed: ${subsErr.message}` }, { status: 500 });
  }

  // ---- 3. Historical ingestion (May-July 2026 baseline) -------------------
  const { data: history, error: histErr } = await supabase
    .from("ingestion_history")
    .select("source_name, title, event_date, event_time")
    .limit(20000);
  if (histErr) {
    return Response.json({ error: `history query failed: ${histErr.message}` }, { status: 500 });
  }

  const rows: Array<[string, string, string, string]> = [];

  // The runner's exact-match dedup key is (source, title, date). Its
  // source column comes from the parser that emitted the row ("Free DC",
  // "Grassroots DC", etc.), not from our DB's source enum. That means a
  // historical row stored with source='trumba' (or 'admin', or
  // 'submission') will never exact-match an incoming 'Free DC' row on
  // its own — the fuzzy fallback was supposed to catch it but is
  // brittle across rewordings. So we emit every published/queued event
  // once per runner source name. Any incoming row with a matching
  // (title, date) will now exact-match regardless of which publisher
  // brought it in this run.
  const RUNNER_SOURCES = [
    "Free DC",
    "Grassroots DC",
    "Rhizome DC",
    "Mobilize",
    "Festival Center",
    "PopVille",
    "Busboys & Poets",
    "Metro DC DSA",
  ];

  const pushForAllSources = (title: string, date: string, time: string) => {
    if (!title || !date) return;
    for (const src of RUNNER_SOURCES) {
      rows.push([src, title, date, time]);
    }
  };

  for (const e of events ?? []) {
    const { date, time } = toEtDateAndTime(e.starts_at as string | null);
    pushForAllSources((e.title as string) ?? "", date, time);
  }

  for (const s of subs ?? []) {
    const payload = (s.event_payload as { title?: string; starts_at?: string } | null) ?? {};
    const { date, time } = toEtDateAndTime(payload.starts_at ?? null);
    pushForAllSources(payload.title ?? "", date, time);
  }

  for (const h of history ?? []) {
    pushForAllSources(
      (h.title as string) ?? "",
      (h.event_date as string) ?? "",
      (h.event_time as string) ?? ""
    );
  }

  // Runner.py dedupes exact matches on (source, title, date) using this
  // shape, and then does a *fuzzy* match against a legacy-named
  // raw_trumba.json file that the caller populates from these same DB rows.
  // Trumba itself is deprecated — this calendar's DB is now authoritative.
  // The fuzzy path uses SequenceMatcher with a 0.72 similarity threshold and
  // strips the "Free DC " prefix, so cross-publisher duplicates like
  // "Freedom Dreaming Session 1" (Grassroots) vs. "Free DC Freedom Dreaming
  // Session 1" (existing DB row) get caught.
  return Response.json(
    { rows, count: rows.length, fetched_at: nowIso },
    { status: 200 }
  );
}

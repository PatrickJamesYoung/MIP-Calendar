/**
 * Two-way Google Calendar sync for spaces reservations.
 *
 * Push side (`pushReservationToGcal`):
 *   Called from the admin status transition when a reservation moves
 *   to `approved` (this system's confirmation state). Idempotent: if
 *   the reservation already has a gcal_event_id, we no-op. On success
 *   we store the returned event id + htmlLink back on the row.
 *
 * Pull side (`pullGcalEvents`):
 *   Called from the daily cron. Uses a persisted syncToken for delta
 *   reads. Creates a new approved reservation (origin='gcal') for
 *   every calendar event we didn't originate ourselves, and marks
 *   the matching reservation cancelled when an event is cancelled.
 *   Never modifies reservations we originated on the web side
 *   (identified by the `mip_origin=web` extended property we set on
 *   push).
 *
 * All Supabase access uses the service-role admin client so the
 * cron and admin-action code paths bypass RLS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deleteEvent,
  insertEvent,
  isGcalConfigured,
  listAllEvents,
  type GcalEvent,
} from "./client";

// ---------- Small helpers ----------

/**
 * Read one or more spaces_settings values into a Map. Returns an
 * empty map on error so callers can decide how to degrade.
 */
async function loadSettings(
  supabase: SupabaseClient,
  keys: string[]
): Promise<Map<string, unknown>> {
  const { data, error } = await supabase
    .from("spaces_settings")
    .select("key,value")
    .in("key", keys);
  if (error) return new Map();
  return new Map((data ?? []).map((r) => [r.key as string, r.value]));
}

function readString(m: Map<string, unknown>, key: string): string {
  const v = m.get(key);
  return typeof v === "string" ? v : "";
}
function readBool(m: Map<string, unknown>, key: string): boolean {
  const v = m.get(key);
  return v === true || v === "true";
}

/**
 * Convert an ISO timestamp string (or null) to a Gcal dateTime shape.
 * Google requires either `dateTime` or `date`; we always use dateTime
 * because spaces reservations have specific times.
 */
function isoToGcalTime(iso: string): { dateTime: string; timeZone: string } {
  return { dateTime: iso, timeZone: "America/New_York" };
}

/**
 * Choose the pair of ISO timestamps that best represent the "event
 * window" on the calendar. Prefer event_start/end (what the requester
 * cares about), fall back to load_in/load_out (what actually blocks
 * the room). Guaranteed to return a valid pair — the DB requires all
 * four columns to be present on any reservation we'd push.
 */
function eventWindow(reservation: {
  event_start_at: string | null;
  event_end_at: string | null;
  load_in_at: string | null;
  load_out_at: string | null;
}): { start: string; end: string } | null {
  const start = reservation.event_start_at ?? reservation.load_in_at;
  const end = reservation.event_end_at ?? reservation.load_out_at;
  if (!start || !end) return null;
  return { start, end };
}

// ============================================================
// Push side
// ============================================================

interface PushableReservation {
  id: string;
  human_id: string;
  event_title: string | null;
  event_description: string | null;
  requester_name: string;
  requester_email: string;
  organization: string | null;
  event_start_at: string | null;
  event_end_at: string | null;
  load_in_at: string | null;
  load_out_at: string | null;
  gcal_event_id: string | null;
}

export interface PushResult {
  ok: boolean;
  skipped?: "not-configured" | "disabled" | "already-pushed" | "no-window";
  eventId?: string;
  htmlLink?: string;
  error?: string;
}

/**
 * Push a single reservation to Google Calendar. Idempotent on
 * `gcal_event_id`. Silent no-op when gcal isn't configured or push is
 * disabled — callers on the admin status path should treat all
 * skip/error outcomes as non-fatal so a Google outage doesn't block a
 * reservation from being marked confirmed.
 */
export async function pushReservationToGcal(
  reservationId: string
): Promise<PushResult> {
  if (!isGcalConfigured()) return { ok: true, skipped: "not-configured" };

  const supabase = createAdminClient();
  const settings = await loadSettings(supabase, [
    "gcal_calendar_id",
    "gcal_push_enabled",
  ]);
  const calendarId = readString(settings, "gcal_calendar_id");
  const pushEnabled = readBool(settings, "gcal_push_enabled");
  if (!pushEnabled || !calendarId) {
    return { ok: true, skipped: "disabled" };
  }

  // Load reservation + lines. We snapshot lines for the location
  // label so a later admin edit that swaps lines doesn't retroactively
  // relabel the calendar event.
  const { data: r, error: rErr } = await supabase
    .from("spaces_reservations")
    .select(
      "id, human_id, event_title, event_description, requester_name, requester_email, organization, event_start_at, event_end_at, load_in_at, load_out_at, gcal_event_id"
    )
    .eq("id", reservationId)
    .single<PushableReservation>();
  if (rErr || !r) {
    return { ok: false, error: rErr?.message ?? "reservation-not-found" };
  }

  if (r.gcal_event_id) {
    return { ok: true, skipped: "already-pushed", eventId: r.gcal_event_id };
  }

  const window = eventWindow(r);
  if (!window) return { ok: true, skipped: "no-window" };

  const { data: lines } = await supabase
    .from("spaces_reservation_lines")
    .select("name_snapshot")
    .eq("reservation_id", r.id);
  const spaceNames = (lines ?? [])
    .map((l) => l.name_snapshot as string)
    .filter(Boolean);
  // The label — what the user asked for. Google Calendar renders
  // `location` as a chip on the event card, which is the closest
  // native affordance to "label" for a room booking.
  const locationLabel = spaceNames.join(", ");

  const summary =
    (r.event_title && r.event_title.trim()) ||
    `Reservation ${r.human_id}`;
  const descriptionLines = [
    r.event_description?.trim() || "",
    "",
    `Requested by: ${r.requester_name} <${r.requester_email}>`,
    r.organization ? `Organization: ${r.organization}` : null,
    `Reservation: ${r.human_id}`,
  ].filter((x): x is string => x !== null);
  const description = descriptionLines.join("\n").trim();

  let created: GcalEvent;
  try {
    created = await insertEvent({
      calendarId,
      summary,
      description,
      location: locationLabel || undefined,
      start: isoToGcalTime(window.start),
      end: isoToGcalTime(window.end),
      privateProps: {
        mip_origin: "web",
        mip_reservation_id: r.id,
        mip_human_id: r.human_id,
      },
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const { error: updErr } = await supabase
    .from("spaces_reservations")
    .update({
      gcal_event_id: created.id,
      gcal_html_link: created.htmlLink ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", r.id);
  if (updErr) {
    // Event was created on Google's side but we failed to persist the
    // link. Not fatal — surface the error but also return the event id
    // so the caller can display it.
    return {
      ok: false,
      error: `stored-partially: ${updErr.message}`,
      eventId: created.id,
      htmlLink: created.htmlLink ?? undefined,
    };
  }

  return {
    ok: true,
    eventId: created.id,
    htmlLink: created.htmlLink ?? undefined,
  };
}

/**
 * Best-effort cleanup: when a reservation is moved OUT of confirmed
 * (e.g. cancelled), remove the matching calendar event. Idempotent.
 */
export async function unpushReservationFromGcal(
  reservationId: string
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  if (!isGcalConfigured()) return { ok: true, skipped: "not-configured" };

  const supabase = createAdminClient();
  const settings = await loadSettings(supabase, ["gcal_calendar_id"]);
  const calendarId = readString(settings, "gcal_calendar_id");
  if (!calendarId) return { ok: true, skipped: "disabled" };

  const { data: r } = await supabase
    .from("spaces_reservations")
    .select("id, gcal_event_id")
    .eq("id", reservationId)
    .single();
  if (!r || !r.gcal_event_id) return { ok: true, skipped: "no-event-id" };

  try {
    await deleteEvent(calendarId, r.gcal_event_id);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  await supabase
    .from("spaces_reservations")
    .update({
      gcal_event_id: null,
      gcal_html_link: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", r.id);
  return { ok: true };
}

// ============================================================
// Pull side
// ============================================================

export interface PullResult {
  ok: boolean;
  skipped?: "not-configured" | "disabled";
  fetched?: number;
  created?: number;
  cancelled?: number;
  ignored?: number;
  bootstrapped?: boolean;
  error?: string;
}

/**
 * Pull events from Google Calendar into `spaces_reservations`. Called
 * from the daily cron. Idempotent — the unique index on gcal_event_id
 * turns re-runs into no-ops.
 */
/**
 * How far into the future to ingest events during a bootstrap /
 * full-list read. We do NOT ingest past events at all — spaces
 * reservations are forward-looking. This cap is critical because
 * `singleEvents=true` expands each recurring event into one API
 * result (and one reservation) per occurrence, so a weekly meeting
 * that runs for a year without this cap becomes 52 reservations.
 */
const PULL_FUTURE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export async function pullGcalEvents(): Promise<PullResult> {
  if (!isGcalConfigured()) return { ok: true, skipped: "not-configured" };

  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const mark = (label: string, from: number) => {
    timings[label] = Date.now() - from;
  };

  const supabase = createAdminClient();
  const tSettings = Date.now();
  const settings = await loadSettings(supabase, [
    "gcal_calendar_id",
    "gcal_pull_enabled",
    "reservation_id_prefix",
  ]);
  const calendarId = readString(settings, "gcal_calendar_id");
  const pullEnabled = readBool(settings, "gcal_pull_enabled");
  if (!pullEnabled || !calendarId) return { ok: true, skipped: "disabled" };
  const idPrefix = readString(settings, "reservation_id_prefix") || "SPACE";
  mark("settings_ms", tSettings);

  // Load the persisted syncToken (if any).
  const tState = Date.now();
  const { data: stateRow } = await supabase
    .from("spaces_gcal_sync_state")
    .select("sync_token")
    .eq("id", 1)
    .single();
  const existingToken = (stateRow?.sync_token as string | null) ?? null;
  mark("state_load_ms", tState);

  // Bootstrap-only window: from now through PULL_FUTURE_WINDOW_MS out.
  // These params are ignored by the API when a syncToken is provided
  // (the delta read returns whatever changed since last sync).
  const now = Date.now();
  const bootstrapTimeMin = new Date(now).toISOString();
  const bootstrapTimeMax = new Date(now + PULL_FUTURE_WINDOW_MS).toISOString();

  const tList = Date.now();
  let listRes = await listAllEvents({
    calendarId,
    syncToken: existingToken ?? undefined,
    timeMin: existingToken ? undefined : bootstrapTimeMin,
    timeMax: existingToken ? undefined : bootstrapTimeMax,
  });

  let bootstrapped = false;
  if (listRes.syncTokenExpired) {
    // Fall back to a fresh bootstrap with the same forward window.
    bootstrapped = true;
    listRes = await listAllEvents({
      calendarId,
      timeMin: bootstrapTimeMin,
      timeMax: bootstrapTimeMax,
    });
  }
  mark("gcal_list_ms", tList);
  const fetched = listRes.items.length;

  // ---- Bucket events into skip / cancel / candidate-insert ----
  //
  // The old implementation walked events one-by-one and made a fresh
  // DB roundtrip per event (SELECT for human-id collisions + SELECT
  // for cancellation matches + INSERT). At ~50-100ms per roundtrip on
  // the Supabase pooler that trivially blew Vercel's 60s function
  // budget on bootstraps with hundreds of expanded recurring events.
  //
  // We now:
  //   1. Fetch every existing (gcal_event_id, id, status, origin) in
  //      a single query keyed by the ids in this batch.
  //   2. Bulk-update cancellations with a single UPDATE .. WHERE IN.
  //   3. Bulk-insert new events with a single INSERT.
  //   4. Generate human IDs client-side (32^4 = ~1M suffix space per
  //      day, batch size < 1000, so collision risk is negligible; the
  //      unique index on gcal_event_id already guards the important
  //      idempotency invariant, and a duplicate human_id from a
  //      collision would just fail the batch and be picked up on the
  //      next run).
  const ownEvents: string[] = []; // event ids we originated on the web
  const cancelIds: string[] = [];
  const candidates: Array<{
    gcal_event_id: string;
    gcal_html_link: string | null;
    event_title: string | null;
    event_description: string | null;
    start: string;
    end: string;
  }> = [];
  let ignored = 0;

  for (const ev of listRes.items) {
    const isOurs = ev.extendedProperties?.private?.mip_origin === "web";
    if (isOurs) {
      ownEvents.push(ev.id);
      ignored++;
      continue;
    }
    if (ev.status === "cancelled") {
      cancelIds.push(ev.id);
      continue;
    }
    const start = ev.start?.dateTime ?? ev.start?.date;
    const end = ev.end?.dateTime ?? ev.end?.date;
    if (!start || !end) {
      ignored++;
      continue;
    }
    candidates.push({
      gcal_event_id: ev.id,
      gcal_html_link: ev.htmlLink ?? null,
      event_title: ev.summary ?? null,
      event_description: ev.description ?? null,
      start,
      end,
    });
  }

  // ---- Load existing rows for every event we might touch, in one query ----
  const eventIdsToLookup = Array.from(
    new Set<string>([
      ...cancelIds,
      ...candidates.map((c) => c.gcal_event_id),
    ])
  );
  const tExisting = Date.now();
  const existing = new Map<
    string,
    { id: string; status: string; origin: string | null }
  >();
  // Postgres has a ~65k param cap; chunk defensively at 500.
  for (let i = 0; i < eventIdsToLookup.length; i += 500) {
    const chunk = eventIdsToLookup.slice(i, i + 500);
    const { data } = await supabase
      .from("spaces_reservations")
      .select("id, status, origin, gcal_event_id")
      .in("gcal_event_id", chunk);
    for (const row of data ?? []) {
      const gid = (row as { gcal_event_id: string | null }).gcal_event_id;
      if (!gid) continue;
      existing.set(gid, {
        id: (row as { id: string }).id,
        status: (row as { status: string }).status,
        origin: (row as { origin: string | null }).origin,
      });
    }
  }
  mark("existing_lookup_ms", tExisting);

  // ---- Handle cancellations in one UPDATE ----
  let cancelled = 0;
  const cancelRowIds: string[] = [];
  for (const gid of cancelIds) {
    const match = existing.get(gid);
    if (match && match.origin === "gcal" && match.status !== "cancelled") {
      cancelRowIds.push(match.id);
    } else {
      ignored++;
    }
  }
  const tCancel = Date.now();
  if (cancelRowIds.length > 0) {
    const nowIsoCancel = new Date().toISOString();
    // Chunk both queries to stay well under param limits.
    for (let i = 0; i < cancelRowIds.length; i += 500) {
      const chunk = cancelRowIds.slice(i, i + 500);
      await supabase
        .from("spaces_reservations")
        .update({ status: "cancelled", updated_at: nowIsoCancel })
        .in("id", chunk);
      await supabase.from("spaces_activity").insert(
        chunk.map((rid) => ({
          reservation_id: rid,
          actor_email: null,
          action: "status_changed",
          detail: { status: "cancelled", source: "gcal-sync" },
        }))
      );
      cancelled += chunk.length;
    }
  }
  mark("cancel_ms", tCancel);

  // ---- Handle new inserts in one INSERT ----
  const toInsert = candidates.filter((c) => !existing.has(c.gcal_event_id));
  ignored += candidates.length - toInsert.length; // already-present candidates
  const tInsert = Date.now();
  let created = 0;
  if (toInsert.length > 0) {
    const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rows = toInsert.map((c) => ({
      human_id: `${idPrefix}-${yyyymmdd}-${randomSuffix(6)}`,
      status: "approved",
      origin: "gcal",
      gcal_event_id: c.gcal_event_id,
      gcal_html_link: c.gcal_html_link,
      event_title: c.event_title,
      event_description: c.event_description,
      requester_name: "Google Calendar",
      requester_email: "calendar@movementinfrastructureproject.org",
      organization: null,
      event_start_at: c.start,
      event_end_at: c.end,
      load_in_at: c.start,
      load_out_at: c.end,
      hours_billed: 0,
      subtotal_full: 0,
      contribution_multiplier: 1,
      contribution_total: 0,
      acknowledged_tentative: true,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error, count } = await supabase
        .from("spaces_reservations")
        .insert(chunk, { count: "exact" });
      if (error) {
        // A duplicate-key collision on gcal_event_id (rare given the
        // pre-lookup, but possible in a race with a concurrent run)
        // aborts the whole insert; fall back to per-row inserts so
        // one bad event doesn't wedge the batch.
        if (/duplicate key|23505/i.test(error.message ?? "")) {
          for (const row of chunk) {
            const { error: rowErr } = await supabase
              .from("spaces_reservations")
              .insert(row);
            if (!rowErr) created++;
            else ignored++;
          }
        } else {
          // Log but don't throw — partial progress is better than none.
          console.error("gcal-sync insert-chunk-failed:", error.message);
          ignored += chunk.length;
        }
      } else {
        created += count ?? chunk.length;
      }
    }
  }
  mark("insert_ms", tInsert);

  // Persist the new syncToken so the next run is a cheap delta.
  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    id: 1,
    sync_token: listRes.nextSyncToken ?? existingToken,
    last_delta_sync_at: nowIso,
    updated_at: nowIso,
  };
  if (bootstrapped || !existingToken) {
    updatePayload.last_full_sync_at = nowIso;
  }
  const tPersist = Date.now();
  await supabase
    .from("spaces_gcal_sync_state")
    .upsert(updatePayload, { onConflict: "id" });
  mark("persist_state_ms", tPersist);

  timings.total_ms = Date.now() - t0;
  // Log so a scheduled failure's next successful run tells us where
  // the time went (Vercel captures console output on function logs).
  console.log(
    `[gcal-sync] fetched=${fetched} own=${ownEvents.length} cancelled=${cancelled} created=${created} ignored=${ignored} bootstrapped=${bootstrapped} timings=${JSON.stringify(timings)}`
  );

  return {
    ok: true,
    fetched,
    created,
    cancelled,
    ignored,
    bootstrapped,
  };
}

// ---------- ID minting ----------

function randomSuffix(len: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Crockford-ish
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

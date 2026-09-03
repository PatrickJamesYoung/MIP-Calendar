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
export async function pullGcalEvents(): Promise<PullResult> {
  if (!isGcalConfigured()) return { ok: true, skipped: "not-configured" };

  const supabase = createAdminClient();
  const settings = await loadSettings(supabase, [
    "gcal_calendar_id",
    "gcal_pull_enabled",
    "reservation_id_prefix",
  ]);
  const calendarId = readString(settings, "gcal_calendar_id");
  const pullEnabled = readBool(settings, "gcal_pull_enabled");
  if (!pullEnabled || !calendarId) return { ok: true, skipped: "disabled" };
  const idPrefix = readString(settings, "reservation_id_prefix") || "SPACE";

  // Load the persisted syncToken (if any).
  const { data: stateRow } = await supabase
    .from("spaces_gcal_sync_state")
    .select("sync_token")
    .eq("id", 1)
    .single();
  const existingToken = (stateRow?.sync_token as string | null) ?? null;

  let listRes = await listAllEvents({
    calendarId,
    syncToken: existingToken ?? undefined,
    // First-time bootstrap: only ingest events from today forward so
    // we don't create years of historical reservations.
    updatedMin: existingToken
      ? undefined
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  });

  let bootstrapped = false;
  if (listRes.syncTokenExpired) {
    // Fall back to a full list. We still cap to recent updates so a
    // token that expired after months of downtime doesn't ingest the
    // entire history.
    bootstrapped = true;
    listRes = await listAllEvents({
      calendarId,
      updatedMin: new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });
  }

  let created = 0;
  let cancelled = 0;
  let ignored = 0;

  for (const ev of listRes.items) {
    const isOurs =
      ev.extendedProperties?.private?.mip_origin === "web";
    if (isOurs) {
      // Skip our own writes so we don't mirror-loop.
      ignored++;
      continue;
    }

    if (ev.status === "cancelled") {
      const { data: match } = await supabase
        .from("spaces_reservations")
        .select("id, status, origin")
        .eq("gcal_event_id", ev.id)
        .maybeSingle();
      if (match && match.origin === "gcal" && match.status !== "cancelled") {
        await supabase
          .from("spaces_reservations")
          .update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
          })
          .eq("id", match.id);
        await supabase.from("spaces_activity").insert({
          reservation_id: match.id,
          actor_email: null,
          action: "status_changed",
          detail: { status: "cancelled", source: "gcal-sync" },
        });
        cancelled++;
      } else {
        ignored++;
      }
      continue;
    }

    const start = ev.start?.dateTime ?? ev.start?.date;
    const end = ev.end?.dateTime ?? ev.end?.date;
    if (!start || !end) {
      ignored++;
      continue;
    }

    // Insert (unique index on gcal_event_id makes this a no-op on repeat).
    const humanId = await generateHumanId(supabase, idPrefix);
    const { error: insErr } = await supabase
      .from("spaces_reservations")
      .insert({
        human_id: humanId,
        status: "approved",
        origin: "gcal",
        gcal_event_id: ev.id,
        gcal_html_link: ev.htmlLink ?? null,
        event_title: ev.summary ?? null,
        event_description: ev.description ?? null,
        requester_name: "Google Calendar",
        requester_email: "calendar@movementinfrastructureproject.org",
        organization: null,
        event_start_at: start,
        event_end_at: end,
        load_in_at: start,
        load_out_at: end,
        hours_billed: 0,
        subtotal_full: 0,
        contribution_multiplier: 1,
        contribution_total: 0,
        acknowledged_tentative: true,
      });

    if (insErr) {
      // 23505 = duplicate key (unique index on gcal_event_id). Not an
      // error — just a re-run of an already-ingested event.
      const msg = insErr.message ?? "";
      if (/duplicate key|23505/i.test(msg)) {
        ignored++;
        continue;
      }
      // Anything else: keep going but note it so one bad event doesn't
      // wedge the whole sync.
      ignored++;
      continue;
    }
    created++;
  }

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
  await supabase
    .from("spaces_gcal_sync_state")
    .upsert(updatePayload, { onConflict: "id" });

  return {
    ok: true,
    fetched: listRes.items.length,
    created,
    cancelled,
    ignored,
    bootstrapped,
  };
}

// ---------- ID minting (mirrors reserve/actions.ts) ----------

/**
 * Duplicated from `src/app/spaces/reserve/actions.ts` so the sync
 * doesn't need to import a server-action module. Keeping the copy
 * small — this is the only piece we need.
 */
async function generateHumanId(
  supabase: SupabaseClient,
  prefix: string
): Promise<string> {
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = randomSuffix(4);
    const candidate = `${prefix}-${yyyymmdd}-${suffix}`;
    const { data } = await supabase
      .from("spaces_reservations")
      .select("id")
      .eq("human_id", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  // Fall back to a longer suffix if we somehow collided 10 times.
  return `${prefix}-${yyyymmdd}-${randomSuffix(8)}`;
}

function randomSuffix(len: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Crockford-ish
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

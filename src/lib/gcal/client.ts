/**
 * Minimal Google Calendar v3 client.
 *
 * Structural mirror of `src/lib/email/gmail-client.ts`. We reuse the
 * same OAuth 2.0 client (GOOGLE_OAUTH_CLIENT_ID + _CLIENT_SECRET) but
 * mint a separate refresh token for the calendar API scope so a
 * Gmail-token compromise doesn't also grant calendar write access.
 *
 * Config (env):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_CALENDAR_REFRESH_TOKEN  — long-lived refresh token minted
 *                                    by the MIP admin account with
 *                                    https://www.googleapis.com/auth/calendar
 *                                    scope. See scripts/README.md.
 *
 * When any of the three is unset, `isGcalConfigured()` returns false
 * and callers no-op so the site keeps working before Google Cloud is
 * wired up.
 *
 * We intentionally do NOT depend on `googleapis` — the three REST
 * calls we need (token refresh, events.insert, events.list) are
 * trivial and the SDK adds ~10 MB to the serverless bundle.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GCAL_API_BASE = "https://www.googleapis.com/calendar/v3";

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}
let cached: CachedToken | null = null;

export function isGcalConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
  );
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt - 30_000 > now) return cached.accessToken;

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN!,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `gcal-oauth-refresh-failed: ${res.status} ${text.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cached = {
    accessToken: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cached.accessToken;
}

// ---------- Types (only the fields we actually use) ----------

export interface GcalEventDateTime {
  dateTime?: string; // RFC3339
  date?: string;     // YYYY-MM-DD (all-day)
  timeZone?: string;
}

export interface GcalEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GcalEventDateTime;
  end?: GcalEventDateTime;
  updated?: string;
  created?: string;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

export interface GcalListResponse {
  items: GcalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface InsertEventArgs {
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  start: GcalEventDateTime;
  end: GcalEventDateTime;
  /**
   * private extended properties. We tag reservations we push with
   * `mip_origin=web` and `mip_reservation_id=<uuid>` so the pull-side
   * sync can identify and skip its own writes.
   */
  privateProps?: Record<string, string>;
}

// ---------- Ops ----------

/**
 * Insert an event on `calendarId`. Returns the created event. Throws
 * on any non-2xx.
 */
export async function insertEvent(args: InsertEventArgs): Promise<GcalEvent> {
  const token = await getAccessToken();
  const url = `${GCAL_API_BASE}/calendars/${encodeURIComponent(args.calendarId)}/events`;

  const body: Record<string, unknown> = {
    summary: args.summary,
    description: args.description,
    location: args.location,
    start: args.start,
    end: args.end,
  };
  if (args.privateProps && Object.keys(args.privateProps).length > 0) {
    body.extendedProperties = { private: args.privateProps };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `gcal-insert-failed: ${res.status} ${text.slice(0, 300)}`
    );
  }
  return (await res.json()) as GcalEvent;
}

/**
 * Delete an event on `calendarId`. 404 is treated as success so we
 * can safely call this on already-cancelled or already-deleted rows.
 */
export async function deleteEvent(
  calendarId: string,
  eventId: string
): Promise<void> {
  const token = await getAccessToken();
  const url = `${GCAL_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `gcal-delete-failed: ${res.status} ${text.slice(0, 300)}`
    );
  }
}

export interface ListEventsArgs {
  calendarId: string;
  /**
   * If provided, do a delta read. Google returns a 410 GONE if the
   * token has expired; callers must fall back to a full list without
   * `syncToken` in that case.
   */
  syncToken?: string;
  /**
   * If provided (and syncToken is NOT), only fetch events updated at
   * or after this ISO timestamp. Used on first-time bootstrap to
   * avoid ingesting years of history.
   */
  updatedMin?: string;
  /**
   * If provided (and syncToken is NOT), only fetch events that start
   * at or after this ISO timestamp. Google requires this to be a
   * valid RFC3339 timestamp with an offset. Combined with `timeMax`
   * this caps recurring-event expansion, which is critical when
   * `singleEvents=true`.
   */
  timeMin?: string;
  /**
   * If provided (and syncToken is NOT), only fetch events that end
   * before this ISO timestamp. See `timeMin` for why this matters.
   */
  timeMax?: string;
  pageToken?: string;
  maxResults?: number;
}

export interface ListEventsResult {
  items: GcalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  /**
   * True when Google returned 410 GONE and the caller must re-bootstrap.
   */
  syncTokenExpired: boolean;
}

/**
 * Single page of events.list. On sync-token expiry (410) we return
 * `syncTokenExpired: true` and the caller re-runs without a token.
 */
export async function listEventsPage(
  args: ListEventsArgs
): Promise<ListEventsResult> {
  const token = await getAccessToken();
  const params = new URLSearchParams();
  params.set("singleEvents", "true"); // expand recurring so each occurrence gets its own reservation
  params.set("showDeleted", "true");   // needed on delta reads to see cancellations
  params.set("maxResults", String(args.maxResults ?? 250));
  if (args.pageToken) params.set("pageToken", args.pageToken);
  if (args.syncToken) {
    params.set("syncToken", args.syncToken);
  } else {
    // Full list mode. orderBy, updatedMin, timeMin, and timeMax are
    // only allowed when NOT using a syncToken. Google enforces this
    // and returns 400 otherwise.
    params.set("orderBy", "updated");
    if (args.updatedMin) params.set("updatedMin", args.updatedMin);
    if (args.timeMin) params.set("timeMin", args.timeMin);
    if (args.timeMax) params.set("timeMax", args.timeMax);
  }

  const url = `${GCAL_API_BASE}/calendars/${encodeURIComponent(args.calendarId)}/events?${params.toString()}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 410) {
    return { items: [], syncTokenExpired: true };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `gcal-list-failed: ${res.status} ${text.slice(0, 300)}`
    );
  }
  const json = (await res.json()) as GcalListResponse;
  return {
    items: json.items ?? [],
    nextPageToken: json.nextPageToken,
    nextSyncToken: json.nextSyncToken,
    syncTokenExpired: false,
  };
}

/**
 * Walk pagination and return the full set of events plus the final
 * syncToken. Used by the daily cron.
 */
export async function listAllEvents(
  args: Omit<ListEventsArgs, "pageToken">
): Promise<{ items: GcalEvent[]; nextSyncToken?: string; syncTokenExpired: boolean }> {
  const collected: GcalEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  for (let page = 0; page < 40; page++) {
    // Hard page cap so a runaway loop can't spin forever on a bad
    // response — 40 * 250 = 10k events, more than enough for a daily
    // delta on this calendar.
    const res = await listEventsPage({ ...args, pageToken });
    if (res.syncTokenExpired) {
      return { items: [], syncTokenExpired: true };
    }
    collected.push(...res.items);
    if (res.nextPageToken) {
      pageToken = res.nextPageToken;
      continue;
    }
    nextSyncToken = res.nextSyncToken;
    break;
  }
  return { items: collected, nextSyncToken, syncTokenExpired: false };
}

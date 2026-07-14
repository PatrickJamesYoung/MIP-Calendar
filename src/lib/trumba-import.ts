/**
 * Trumba iCal feed parser + normalizer for MIP Calendar.
 *
 * Reads the .ics feed at https://www.trumba.com/calendars/Reaction.ics
 * and produces `ParsedTrumbaEvent` records ready for upsert into the
 * `events` table.
 *
 * Trumba-specific quirks handled:
 * - Line folding (RFC 5545) — continuation lines start with a space or tab
 * - Backslash escapes in values (\, \; \n \\)
 * - HTML entities in text fields (&amp;, &#39;, &#x1F33F;, &#8230;)
 * - `X-TRUMBA-CUSTOMFIELD;NAME="Event image"` wraps the URL in an <a> tag
 * - Two "Event Type" fields exist: internal (ID=21) numeric template
 *   name (ignore), and user-facing (ID=64890) which matches the
 *   event_types seed. We use the second occurrence.
 * - CATEGORIES maps directly to overlay_calendar slug/name
 * - UID looks like `http://uid.trumba.com/event/194785347` — we keep the
 *   full UID as external_id for idempotent upsert
 */

// ---------- Types ----------

export interface RawIcsEvent {
  [key: string]: string;
}

export interface ParsedTrumbaEvent {
  external_id: string; // Trumba UID, used for idempotent upsert
  title: string;
  slug: string;
  description: string | null;
  starts_at: string; // ISO 8601 UTC
  ends_at: string | null;
  all_day: boolean;
  timezone: string;
  location_text: string | null;
  location_type: "in_person" | "online" | "hybrid" | null;
  image_url: string | null;
  cost: string | null;
  host_org: string | null;
  web_link: string | null;
  category: string | null; // e.g. "Movement Calendar" — mapped to overlay by caller
  event_type_name: string | null; // e.g. "Meeting", "Action" — mapped to event_type by caller
  raw_dtstart: string; // for debugging
}

// ---------- iCal line unfolding & parsing ----------

/**
 * Unfold RFC 5545 line continuations. Any line that begins with a space or
 * tab is a continuation of the previous line — join them back together.
 */
function unfoldLines(ics: string): string[] {
  const lines = ics.split(/\r?\n/);
  const unfolded: string[] = [];
  for (const line of lines) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

/**
 * Unescape iCal value: `\,` → `,`, `\;` → `;`, `\n` → newline, `\\` → `\`.
 */
function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Decode common HTML entities Trumba emits.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8230;/g, "…")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/**
 * Strip all HTML tags — useful for LOCATION values that Trumba wraps in
 * <a href=…> for URL suffixes.
 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Parse one iCal line into `key, params, value`.
 * Examples:
 *   `SUMMARY:Foo bar` → key=SUMMARY, params={}, value=Foo bar
 *   `DTSTART;TZID=America/New_York:20260714T100000` → key=DTSTART,
 *     params={TZID: "America/New_York"}, value=20260714T100000
 *   `X-TRUMBA-CUSTOMFIELD;NAME="Event image";ID=40;TYPE=Image:<a href=…>`
 *     → key=X-TRUMBA-CUSTOMFIELD, params={NAME:"Event image",ID:"40",TYPE:"Image"}, value=<a href=…>
 */
function parseLine(line: string): {
  key: string;
  params: Record<string, string>;
  value: string;
} | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx < 0) return null;
  const keyAndParams = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);

  const parts = keyAndParams.split(";");
  const key = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    const pKey = part.slice(0, eqIdx).toUpperCase();
    let pVal = part.slice(eqIdx + 1);
    if (pVal.startsWith('"') && pVal.endsWith('"')) {
      pVal = pVal.slice(1, -1);
    }
    params[pKey] = pVal;
  }
  return { key, params, value };
}

// ---------- Date parsing ----------

/**
 * Parse a Trumba DTSTART / DTEND into a UTC ISO string plus whether it's
 * all-day. Handles three cases:
 * - Date-only:  `DTSTART;VALUE=DATE:20260714` (all-day)
 * - Zoned:      `DTSTART;TZID=America/New_York:20260714T100000`
 * - UTC:        `DTSTART:20260714T140000Z`
 */
function parseIcsDate(
  value: string,
  params: Record<string, string>
): { iso: string; allDay: boolean } {
  const isDateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(value);

  if (isDateOnly) {
    // Treat as midnight in America/New_York.
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return { iso: `${y}-${m}-${d}T00:00:00-04:00`, allDay: true };
    // Note: DST offset is fine here — Postgres will store as timestamptz.
    // The all_day flag tells the UI to ignore time-of-day anyway.
  }

  // Format: YYYYMMDDTHHmmSS(Z)?
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/
  );
  if (!match) throw new Error(`Unrecognized iCal date value: ${value}`);
  const [, y, m, d, hh, mm, ss, z] = match;

  if (z || !params.TZID) {
    return { iso: `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`, allDay: false };
  }

  // Zoned time — the timestamp value is wall-clock time in `tz`. To get UTC
  // we ask 'what UTC instant, when displayed in tz, shows these wall-clock
  // digits?' — that instant is our target.
  //
  // Approach: pretend the wall-clock reading IS UTC (naiveLocal), then look
  // up what wall-clock those same milliseconds render as in tz. The delta is
  // the tz offset relative to UTC. To recover the true UTC instant, subtract
  // that delta from naiveLocal.
  //
  // Prior bug: we ADDED the delta instead of subtracting it, so every event
  // ended up shifted by 2 * the tz offset (8 h during EDT, 10 h during EST).
  const tz = params.TZID;
  const naiveLocal = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
  const offsetMinutes = getTimezoneOffsetMinutes(naiveLocal, tz);
  const utcMs = naiveLocal.getTime() - offsetMinutes * 60_000;
  return { iso: new Date(utcMs).toISOString(), allDay: false };
}

/**
 * Return the offset (in minutes) that must be *added* to a naive local
 * timestamp interpreted in the given IANA timezone to get UTC.
 * i.e. if it's 10:00 in America/New_York on that date, this returns +240
 * (EDT) or +300 (EST).
 */
function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const asUtc = Date.UTC(
    parseInt(get("year"), 10),
    parseInt(get("month"), 10) - 1,
    parseInt(get("day"), 10),
    parseInt(get("hour"), 10) === 24 ? 0 : parseInt(get("hour"), 10),
    parseInt(get("minute"), 10),
    parseInt(get("second"), 10)
  );
  return (asUtc - date.getTime()) / 60_000;
}

// ---------- Slug generation ----------

const SLUG_RESERVED = new Set(["admin", "api", "auth", "e", "submit", "subscribe"]);

/**
 * Generate a URL-safe slug from a title. Falls back to the external_id
 * hash if the title is empty or would collide with a reserved route.
 */
export function slugify(input: string, externalId: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!base || SLUG_RESERVED.has(base)) {
    // Fallback: last 8 chars of external_id
    const suffix = externalId.slice(-8).replace(/[^a-z0-9]/gi, "").toLowerCase();
    return `event-${suffix || "unknown"}`;
  }
  return base;
}

// ---------- Trumba custom field extraction ----------

/**
 * Extract a URL from Trumba's "Event image" custom field value.
 * The raw value looks like:
 *   `<a href="https://www.trumba.com/i/…jpg" target="_blank" …>www.trumba.com…</a>`
 * We pull the href attribute out.
 */
function extractImageUrl(raw: string): string | null {
  const match = raw.match(/href="([^"]+)"/i);
  return match ? decodeEntities(match[1]) : null;
}

/**
 * Guess location_type from LOCATION text + presence of an Online Location field.
 */
function inferLocationType(
  physicalLocation: string | null,
  onlineLocation: string | null
): "in_person" | "online" | "hybrid" | null {
  const hasPhysical = !!physicalLocation && physicalLocation.trim().length > 0
    && !/^tba$/i.test(physicalLocation.trim());
  const hasOnline = !!onlineLocation && onlineLocation.trim().length > 0;
  if (hasPhysical && hasOnline) return "hybrid";
  if (hasOnline) return "online";
  if (hasPhysical) return "in_person";
  return null;
}

// ---------- Main parser ----------

/**
 * Parse a full iCal feed into an array of raw event objects (one per
 * VEVENT block). Each key/value pair is preserved verbatim with the field
 * params encoded as `KEY;PARAM1=…;PARAM2=…`.
 */
export function parseIcs(ics: string): RawIcsEvent[] {
  const lines = unfoldLines(ics);
  const events: RawIcsEvent[] = [];
  let current: RawIcsEvent | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;

    // Reconstruct a compound key so we don't lose params like TZID / NAME
    const paramStr = Object.entries(parsed.params)
      .map(([k, v]) => `${k}=${v}`)
      .join(";");
    const compoundKey = paramStr ? `${parsed.key};${paramStr}` : parsed.key;

    // Allow duplicate custom-field keys by appending an index
    let finalKey = compoundKey;
    let idx = 1;
    while (finalKey in current) {
      finalKey = `${compoundKey}#${idx++}`;
    }
    current[finalKey] = parsed.value;
  }

  return events;
}

/**
 * Convert a raw iCal event to a normalized `ParsedTrumbaEvent`.
 * Returns null if the event is missing required fields.
 */
export function normalizeTrumbaEvent(raw: RawIcsEvent): ParsedTrumbaEvent | null {
  // Find title, dates, uid
  const title = raw.SUMMARY ? decodeEntities(unescapeIcs(raw.SUMMARY)).trim() : "";
  const uid = raw.UID?.trim();

  if (!title || !uid) return null;

  // DTSTART — the key may be `DTSTART`, `DTSTART;VALUE=DATE`, or `DTSTART;TZID=…`
  const dtstartEntry = Object.entries(raw).find(([k]) => k.startsWith("DTSTART"));
  if (!dtstartEntry) return null;
  const [dtstartKey, dtstartVal] = dtstartEntry;
  const dtstartParams = parseKeyParams(dtstartKey);
  const start = parseIcsDate(dtstartVal, dtstartParams);

  const dtendEntry = Object.entries(raw).find(([k]) => k.startsWith("DTEND"));
  let endIso: string | null = null;
  if (dtendEntry) {
    const [dtendKey, dtendVal] = dtendEntry;
    endIso = parseIcsDate(dtendVal, parseKeyParams(dtendKey)).iso;
  }

  // Description
  const rawDesc = raw.DESCRIPTION ? unescapeIcs(raw.DESCRIPTION) : null;
  // Keep the HTML (Trumba emits <br>, <strong>, <a>, etc.) but decode entities.
  const description = rawDesc ? decodeEntities(rawDesc).trim() || null : null;

  // Location — Trumba often stuffs URL/handle after `//` separators, and wraps
  // the last part in an <a> tag. Strip HTML so it's readable plain text.
  const rawLocation = raw.LOCATION ? unescapeIcs(raw.LOCATION) : null;
  const location_text = rawLocation ? stripHtml(decodeEntities(rawLocation)) || null : null;

  // URL → web_link
  const web_link = raw.URL ? unescapeIcs(raw.URL).trim() : null;

  // Categories: Trumba emits one overlay name per event, but the name itself
  // may contain commas (e.g. "Events, Meetings, Festivals"). Trumba doesn't
  // escape them per iCal spec, so we treat the full value as a single string.
  const category = raw.CATEGORIES
    ? decodeEntities(unescapeIcs(raw.CATEGORIES)).trim()
    : null;

  // Custom fields — iterate keys, look for X-TRUMBA-CUSTOMFIELD entries
  let image_url: string | null = null;
  let cost: string | null = null;
  let host_org: string | null = null;
  let event_type_name: string | null = null;
  let online_location: string | null = null;

  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("X-TRUMBA-CUSTOMFIELD")) continue;
    const params = parseKeyParams(key);
    const name = params.NAME;
    const val = unescapeIcs(value);

    switch (name) {
      case "Event image":
        image_url = extractImageUrl(val);
        break;
      case "Cost":
        cost = decodeEntities(val).trim() || null;
        break;
      case "Host Organization":
        host_org = decodeEntities(val).trim() || null;
        break;
      case "Event Type": {
        // Two Event Type fields exist. The internal (ID=21, TYPE=number)
        // holds template names like "Default Template" or "Reference Events"
        // — ignore those. The user-facing (ID=64890, TYPE=CustomAsset)
        // holds real category names like "Meeting", "Action".
        if (params.ID !== "21") {
          const decoded = decodeEntities(val).trim();
          if (decoded && decoded !== "Default Template") {
            // May be comma-separated ("Arts & Culture,Fundraiser") — take first
            event_type_name = decoded.split(",")[0].trim();
          }
        }
        break;
      }
      case "Online Location":
        online_location = decodeEntities(val).trim() || null;
        break;
    }
  }

  const location_type = inferLocationType(location_text, online_location);

  // If Online Location is set but no physical location, prefer showing the online one
  const final_location_text =
    location_type === "online" && online_location
      ? online_location
      : location_text;

  const slug = slugify(title, uid);

  return {
    external_id: uid,
    title,
    slug,
    description,
    starts_at: start.iso,
    ends_at: endIso,
    all_day: start.allDay,
    timezone: "America/New_York",
    location_text: final_location_text,
    location_type,
    image_url,
    cost,
    host_org,
    web_link,
    category,
    event_type_name,
    raw_dtstart: dtstartVal,
  };
}

/**
 * Re-parse the params of a compound iCal key (`DTSTART;TZID=…`).
 */
function parseKeyParams(compoundKey: string): Record<string, string> {
  const parts = compoundKey.split(";");
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    // Strip any duplicate-suffix like `#1`
    const clean = part.replace(/#\d+$/, "");
    const eqIdx = clean.indexOf("=");
    if (eqIdx < 0) continue;
    params[clean.slice(0, eqIdx).toUpperCase()] = clean.slice(eqIdx + 1);
  }
  return params;
}

/**
 * Parse an entire feed into normalized events, filtering out unparseable ones.
 */
export function parseTrumbaFeed(ics: string): ParsedTrumbaEvent[] {
  const raw = parseIcs(ics);
  const normalized: ParsedTrumbaEvent[] = [];
  for (const r of raw) {
    try {
      const n = normalizeTrumbaEvent(r);
      if (n) normalized.push(n);
    } catch (e) {
      // Skip events that fail to parse; log for diagnostics.
      console.warn("Skipping event:", (e as Error).message, r.UID);
    }
  }
  return normalized;
}

/**
 * Filter to upcoming events only (starts_at >= now).
 */
export function filterUpcoming(
  events: ParsedTrumbaEvent[],
  now: Date = new Date()
): ParsedTrumbaEvent[] {
  return events.filter((e) => new Date(e.starts_at) >= now);
}

export const TRUMBA_ICS_URL = "https://www.trumba.com/calendars/Reaction.ics";

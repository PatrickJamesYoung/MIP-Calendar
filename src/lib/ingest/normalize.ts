/**
 * Normalize a raw event record emitted by the DC events runner.py into
 * the shape a `submissions.event_payload` expects.
 *
 * runner.py emits records with these keys (from README.md in the handoff bundle):
 *   run_date, source, title, date ("M/D/YYYY"), time ("H:MM AM"),
 *   end_time, location, host, rsvp_link, event_url, image_url,
 *   description, movement_calendar, submit
 *
 * We map to the event_payload shape used by the submit action:
 *   title, description, starts_at, ends_at, all_day, timezone,
 *   location_text, location_type, cost, host_org, web_link, image_url,
 *   overlay_calendar_id, event_type_id, accessibility
 */

export interface RunnerEvent {
  run_date?: string;
  source: string;
  title: string;
  date: string; // "M/D/YYYY"
  time?: string; // "H:MM AM" (empty allowed)
  end_time?: string;
  location?: string;
  host?: string;
  rsvp_link?: string;
  event_url?: string;
  image_url?: string;
  description?: string;
  movement_calendar?: string;
  submit?: string;
}

export interface NormalizedEventPayload {
  title: string;
  description: string | null;
  starts_at: string; // ISO 8601 UTC
  ends_at: string | null;
  all_day: boolean;
  timezone: string;
  location_text: string | null;
  location_type: "in_person" | "online" | "hybrid" | null;
  cost: string | null;
  host_org: string | null;
  web_link: string | null;
  image_url: string | null;
  overlay_calendar_id: string | null; // filled in by caller from DB lookup
  event_type_id: string | null;
  accessibility: string[];
}

const ET_TZ = "America/New_York";

/**
 * Parse a "M/D/YYYY" + "H:MM AM/PM" pair as America/New_York wall-clock time
 * and return the corresponding UTC ISO string.
 *
 * If time is empty/missing, the event is treated as all-day starting at 09:00
 * ET (so it sorts sensibly on the calendar; the all_day flag is set true).
 */
export function localDateTimeToUtcIso(dateMDY: string, timeStr: string | undefined | null, tz = ET_TZ): {
  iso: string;
  allDay: boolean;
} {
  const dateMatch = dateMDY.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) {
    throw new Error(`Bad date: ${JSON.stringify(dateMDY)}`);
  }
  const [, mStr, dStr, yStr] = dateMatch;
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  const year = parseInt(yStr, 10);

  let hour = 9;
  let minute = 0;
  let allDay = false;

  const t = (timeStr ?? "").trim();
  if (!t) {
    allDay = true;
  } else {
    const timeMatch = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!timeMatch) {
      throw new Error(`Bad time: ${JSON.stringify(timeStr)}`);
    }
    let h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    const meridiem = timeMatch[3].toUpperCase();
    if (meridiem === "PM" && h !== 12) h += 12;
    if (meridiem === "AM" && h === 12) h = 0;
    hour = h;
    minute = m;
  }

  // Interpret (year, month, day, hour, minute) as wall-clock in tz, return
  // the equivalent UTC instant.
  //
  // Approach: build a naive UTC timestamp for the same wall-clock values,
  // then compute the tz offset at that instant using Intl.DateTimeFormat and
  // subtract it.
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(naiveUtc));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const asUtcOfSameWallClock = Date.UTC(
    parseInt(get("year"), 10),
    parseInt(get("month"), 10) - 1,
    parseInt(get("day"), 10),
    parseInt(get("hour"), 10) === 24 ? 0 : parseInt(get("hour"), 10),
    parseInt(get("minute"), 10),
    parseInt(get("second"), 10)
  );
  const offsetMs = asUtcOfSameWallClock - naiveUtc;
  return {
    iso: new Date(naiveUtc - offsetMs).toISOString(),
    allDay,
  };
}

/**
 * Guess a location_type from the location string.
 * Very forgiving — if we can't decide, we return null and the admin can set it.
 */
function guessLocationType(loc: string | null | undefined): "in_person" | "online" | "hybrid" | null {
  if (!loc) return null;
  const l = loc.toLowerCase();
  if (l.includes("online") || l.includes("zoom") || l.includes("virtual") || l.includes("webinar")) {
    return l.includes("hybrid") ? "hybrid" : "online";
  }
  if (l.includes("hybrid")) return "hybrid";
  return "in_person";
}

/**
 * Build the normalized event_payload from a runner.py record.
 *
 * @param ev              raw record
 * @param movementOverlayId  Movement Calendar overlay UUID (already looked up)
 */
export function normalizeRunnerEvent(
  ev: RunnerEvent,
  movementOverlayId: string | null
): NormalizedEventPayload {
  const { iso: starts_at, allDay } = localDateTimeToUtcIso(ev.date, ev.time);

  let ends_at: string | null = null;
  if (ev.end_time && ev.end_time.trim()) {
    try {
      ends_at = localDateTimeToUtcIso(ev.date, ev.end_time).iso;
    } catch {
      ends_at = null;
    }
  }

  // Prefer rsvp_link, fall back to event_url. Empty strings become null.
  const web_link =
    (ev.rsvp_link && ev.rsvp_link.trim()) ||
    (ev.event_url && ev.event_url.trim()) ||
    null;

  const description = (ev.description ?? "").trim() || null;
  const location_text = (ev.location ?? "").trim() || null;
  const host_org = (ev.host ?? "").trim() || null;
  const image_url = (ev.image_url ?? "").trim() || null;

  return {
    title: ev.title.trim(),
    description,
    starts_at,
    ends_at,
    all_day: allDay,
    timezone: ET_TZ,
    location_text,
    location_type: guessLocationType(location_text),
    cost: null, // runner.py doesn't emit cost — admin can add
    host_org,
    web_link,
    image_url,
    overlay_calendar_id: movementOverlayId,
    event_type_id: null,
    accessibility: [],
  };
}

/**
 * Small date-math helpers for calendar grid views.
 * All calculations happen in America/New_York wall-clock time so grids
 * match how DC-area users experience "today."
 */

export const CAL_TZ = "America/New_York";

/**
 * Get date parts (year, month, day, hour, minute, weekday) for a given
 * Date in the calendar's timezone. Month is 1-12. Weekday is 0-6 (Sun-Sat).
 */
export function partsInTz(d: Date, tz = CAL_TZ) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayShort = get("weekday");
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const hour = parseInt(get("hour"));
  return {
    year: parseInt(get("year")),
    month: parseInt(get("month")),
    day: parseInt(get("day")),
    hour: hour === 24 ? 0 : hour,
    minute: parseInt(get("minute")),
    weekday: weekdayMap[weekdayShort] ?? 0,
  };
}

/** YYYY-MM-DD key for the local day of `d` in the calendar tz. */
export function ymdKey(d: Date, tz = CAL_TZ): string {
  const { year, month, day } = partsInTz(d, tz);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse "YYYY-MM-DD" into a Date at noon in the calendar tz (midpoint = safe). */
export function ymdToDate(ymd: string, tz = CAL_TZ): Date {
  // Interpret as noon local to avoid DST edge cases when we're just using
  // this as a stable anchor for the day.
  const [y, m, d] = ymd.split("-").map(Number);
  // Build ISO in UTC that maps to noon in the target tz. Use a rough offset
  // fixup: start with noon UTC, measure what hour that lands at in tz,
  // shift back to make it noon there.
  const guess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const { hour } = partsInTz(guess, tz);
  const diffHours = 12 - hour;
  guess.setUTCHours(guess.getUTCHours() + diffHours);
  return guess;
}

/** Today's YYYY-MM-DD in the calendar tz. */
export function todayYmd(tz = CAL_TZ): string {
  return ymdKey(new Date(), tz);
}

/**
 * Return the YYYY-MM-DD of the Sunday that starts the week containing `ymd`.
 */
export function startOfWeekYmd(ymd: string, tz = CAL_TZ): string {
  const anchor = ymdToDate(ymd, tz);
  const { weekday } = partsInTz(anchor, tz);
  const sunday = new Date(anchor);
  sunday.setUTCDate(sunday.getUTCDate() - weekday);
  return ymdKey(sunday, tz);
}

/**
 * Add days to a YYYY-MM-DD string, returning the new YYYY-MM-DD.
 */
export function addDaysYmd(ymd: string, days: number, tz = CAL_TZ): string {
  const d = ymdToDate(ymd, tz);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdKey(d, tz);
}

/**
 * Add months to a YYYY-MM-DD string (day-1 truncation for safety).
 */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, d));
  const ny = target.getUTCFullYear();
  const nm = target.getUTCMonth() + 1;
  const nd = target.getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Human month + year label, e.g. "July 2026". */
export function monthYearLabel(ymd: string): string {
  const d = ymdToDate(ymd);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CAL_TZ,
    month: "long",
    year: "numeric",
  }).format(d);
}

/** Human weekday + date label, e.g. "Tue, Jul 14". */
export function shortDayLabel(ymd: string): string {
  const d = ymdToDate(ymd);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CAL_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

/**
 * Given a YYYY-MM-DD anchor, produce the 6-week (42-cell) grid for its month
 * beginning on Sunday. Returns array of {ymd, inMonth} entries in row-major
 * order (row 0 = first week).
 */
export function monthGridCells(anchorYmd: string): Array<{ ymd: string; inMonth: boolean }> {
  const [y, m] = anchorYmd.split("-").map(Number);
  const firstOfMonth = `${y}-${String(m).padStart(2, "0")}-01`;
  const gridStart = startOfWeekYmd(firstOfMonth);
  const cells: Array<{ ymd: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const cellYmd = addDaysYmd(gridStart, i);
    const [cy, cm] = cellYmd.split("-").map(Number);
    cells.push({ ymd: cellYmd, inMonth: cy === y && cm === m });
  }
  return cells;
}

/**
 * Given a YYYY-MM-DD, return the 7 YYYY-MM-DD strings for the week
 * containing it (Sunday through Saturday).
 */
export function weekDays(anchorYmd: string): string[] {
  const start = startOfWeekYmd(anchorYmd);
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
}

/**
 * Group events by their local-day YYYY-MM-DD key.
 */
export function groupEventsByDay<E extends { starts_at: string }>(
  events: E[],
  tz = CAL_TZ
): Map<string, E[]> {
  const map = new Map<string, E[]>();
  for (const e of events) {
    const key = ymdKey(new Date(e.starts_at), tz);
    const bucket = map.get(key);
    if (bucket) bucket.push(e);
    else map.set(key, [e]);
  }
  // Sort each bucket by start time
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  return map;
}

/**
 * Format a start-time-of-day short label in the calendar tz, e.g. "9:30 AM".
 */
export function timeLabel(iso: string, tz = CAL_TZ): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/**
 * Return the minutes since midnight for an ISO timestamp in the calendar tz.
 */
export function minutesOfDay(iso: string, tz = CAL_TZ): number {
  const { hour, minute } = partsInTz(new Date(iso), tz);
  return hour * 60 + minute;
}

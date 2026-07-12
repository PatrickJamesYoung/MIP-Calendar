import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a date as "SAT JUL 11" for date badges. */
export function formatDateBadge(dateStr: string, timezone = "America/New_York"): {
  weekday: string;
  month: string;
  day: string;
} {
  const date = new Date(dateStr);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const parts = formatter.formatToParts(date);
  return {
    weekday: (parts.find((p) => p.type === "weekday")?.value ?? "").toUpperCase(),
    month: (parts.find((p) => p.type === "month")?.value ?? "").toUpperCase(),
    day: parts.find((p) => p.type === "day")?.value ?? "",
  };
}

/** Format a time range for display: "6:00 PM – 8:00 PM" or "6:00 PM" if no end time. */
export function formatTimeRange(
  startStr: string,
  endStr: string | null,
  allDay: boolean,
  timezone = "America/New_York"
): string {
  if (allDay) return "All day";
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  const start = new Date(startStr).toLocaleTimeString("en-US", opts);
  if (!endStr) return start;
  const end = new Date(endStr).toLocaleTimeString("en-US", opts);
  return `${start} – ${end}`;
}

/** Convert a date to a YYYY-MM-DD key in the specified timezone (stable across locales). */
export function dayKeyInTz(dateStr: string, timezone = "America/New_York"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(dateStr));
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

/** Group events by calendar day for feed view date dividers. */
export function groupByDay<T extends { starts_at: string }>(
  events: T[],
  timezone = "America/New_York"
): { dayKey: string; events: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    const dayKey = dayKeyInTz(event.starts_at, timezone);
    if (!groups.has(dayKey)) groups.set(dayKey, []);
    groups.get(dayKey)!.push(event);
  }
  return Array.from(groups.entries()).map(([dayKey, events]) => ({
    dayKey,
    events,
  }));
}

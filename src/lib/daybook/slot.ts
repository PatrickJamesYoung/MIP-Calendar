export type Slot = { edition: "daybook" | "weekly"; publication_date: string };

/**
 * Which Daybook publication (if any) does this instant correspond to on
 * the America/New_York wall clock? Weekdays 06:xx -> daybook,
 * Sundays 07:xx -> weekly. Everything else -> null.
 */
export function slotFor(now: Date): Slot | null {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const publication_date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const wd = parts.weekday as string;
  if (wd === "Sun" && hour === 7) return { edition: "weekly", publication_date };
  if (["Mon", "Tue", "Wed", "Thu", "Fri"].includes(wd) && hour === 6) {
    return { edition: "daybook", publication_date };
  }
  return null;
}

"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent } from "@/lib/types";
import { EventCard } from "./event-card";
import {
  addDaysYmd,
  groupEventsByDay,
  partsInTz,
  startOfWeekYmd,
  todayYmd,
  weekDays,
  ymdToDate,
} from "@/lib/calendar-utils";

interface Props {
  events: CalendarEvent[];
  anchorYmd: string;
  onAnchorChange: (ymd: string) => void;
}

/**
 * Vertical week view: takes the current Sunday–Saturday and shows events
 * grouped under sticky day headers. Same visual language as the main Feed
 * so users can scan quickly. Prev/next arrows navigate by whole weeks.
 */
export function WeekView({ events, anchorYmd, onAnchorChange }: Props) {
  const weekStart = useMemo(() => startOfWeekYmd(anchorYmd), [anchorYmd]);
  const days = useMemo(() => weekDays(anchorYmd), [anchorYmd]);
  const eventsByDay = useMemo(() => groupEventsByDay(events), [events]);
  const today = todayYmd();
  const tomorrow = addDaysYmd(today, 1);

  const firstD = ymdToDate(days[0]);
  const lastD = ymdToDate(days[6]);
  const sameMonth = partsInTz(firstD).month === partsInTz(lastD).month;
  const tzFmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...opts });
  const startPart = tzFmt({ month: "short", day: "numeric" }).format(firstD);
  const endPart = sameMonth
    ? tzFmt({ day: "numeric" }).format(lastD)
    : tzFmt({ month: "short", day: "numeric" }).format(lastD);
  const yearPart = tzFmt({ year: "numeric" }).format(lastD);
  const rangeLabel = `${startPart} – ${endPart}, ${yearPart}`;

  const totalEvents = days.reduce(
    (sum, d) => sum + (eventsByDay.get(d)?.length ?? 0),
    0
  );

  return (
    <div>
      {/* Header controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          type="button"
          onClick={() => onAnchorChange(addDaysYmd(weekStart, -7))}
          className="p-1.5 border border-mip-gray-300 hover:border-mip-purple transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
          aria-label="Previous week"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onAnchorChange(addDaysYmd(weekStart, 7))}
          className="p-1.5 border border-mip-gray-300 hover:border-mip-purple transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
          aria-label="Next week"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onAnchorChange(today)}
          className="px-3 py-1 text-sm border border-mip-gray-300 hover:border-mip-purple transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          This Week
        </button>
        <h2 className="mip-heading text-lg ml-2" style={{ color: "var(--color-mip-purple)" }}>
          {rangeLabel}
        </h2>
      </div>

      <div className="space-y-5">
        {days.map((ymd) => {
          const dayEvents = eventsByDay.get(ymd) ?? [];
          const d = ymdToDate(ymd);
          const label =
            ymd === today
              ? "TODAY"
              : ymd === tomorrow
              ? "TOMORROW"
              : new Intl.DateTimeFormat("en-US", {
                  timeZone: "America/New_York",
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
                  .format(d)
                  .toUpperCase();
          return (
            <section key={ymd} aria-labelledby={`week-day-${ymd}`}>
              <div className="sticky top-[65px] z-10 bg-mip-white/95 backdrop-blur py-1.5 mb-2 border-b border-mip-gray-200 flex items-center gap-3">
                <h3
                  id={`week-day-${ymd}`}
                  className="mip-nav-text"
                  style={{ color: "var(--color-mip-purple)" }}
                >
                  {label}
                </h3>
                {dayEvents.length === 0 ? (
                  <span className="text-xs text-mip-gray-500">No events</span>
                ) : (
                  <span className="text-xs text-mip-gray-500">
                    {dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {dayEvents.length > 0 && (
                <div className="space-y-2">
                  {dayEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {totalEvents === 0 && (
          <div className="text-center py-16 text-mip-gray-500">
            <p className="mip-heading text-xl mb-2">No events this week</p>
            <p className="text-sm">Use the arrows above to browse other weeks.</p>
          </div>
        )}
      </div>
    </div>
  );
}

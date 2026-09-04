"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * Month-grid calendar of space reservations spanning event_start_at →
 * event_end_at. Structural mirror of `gear-reservations-calendar.tsx`,
 * but bars use the event window (not load-in/load-out) so the calendar
 * shows when the space is actually occupied for the event.
 *
 * Denied and cancelled reservations are filtered out by the caller.
 */

export type CalendarStatus =
  | "tentative"
  | "approved"
  | "in_use"
  | "completed";

export interface CalendarReservation {
  id: string;
  human_id: string;
  status: CalendarStatus;
  requester_name: string;
  organization: string | null;
  event_start_at: string; // ISO
  event_end_at: string; // ISO
}

interface Props {
  reservations: CalendarReservation[];
  initialMonth?: string; // "YYYY-MM"
}

const STATUS_COLORS: Record<
  CalendarStatus,
  { bg: string; border: string; text: string }
> = {
  tentative: { bg: "#FEF3C7", border: "#F59E0B", text: "#78350F" },
  approved: { bg: "#DBEAFE", border: "#3B82F6", text: "#1E3A8A" },
  in_use: { bg: "#D1FAE5", border: "#10B981", text: "#064E3B" },
  completed: { bg: "#E5E7EB", border: "#6B7280", text: "#374151" },
};

const STATUS_LABEL: Record<CalendarStatus, string> = {
  tentative: "Tentative",
  approved: "Approved",
  in_use: "In use",
  completed: "Completed",
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function daysBetween(a: Date, b: Date): number {
  const ms =
    Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function SpaceReservationsCalendar({ reservations, initialMonth }: Props) {
  const today = startOfDay(new Date());
  const initial = initialMonth
    ? parseYmd(`${initialMonth}-01`)
    : new Date(today.getFullYear(), today.getMonth(), 1);
  const [cursor, setCursor] = useState<Date>(initial);

  const monthLabel = cursor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const grid = useMemo(
    () => buildMonthGrid(cursor, reservations),
    [cursor, reservations]
  );

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2
          className="mip-heading text-lg"
          style={{ color: "var(--color-mip-purple)" }}
        >
          Reservation calendar
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
            className="px-2 py-1 text-sm border border-mip-gray-300 hover:bg-mip-gray-100"
            style={{ borderRadius: "var(--radius-button)" }}
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() =>
              setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
            }
            className="px-3 py-1 text-sm border border-mip-gray-300 hover:bg-mip-gray-100"
            style={{ borderRadius: "var(--radius-button)" }}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
            className="px-2 py-1 text-sm border border-mip-gray-300 hover:bg-mip-gray-100"
            style={{ borderRadius: "var(--radius-button)" }}
            aria-label="Next month"
          >
            ›
          </button>
          <div className="ml-2 text-sm font-medium text-mip-gray-800 min-w-[10rem] text-right">
            {monthLabel}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-2 text-xs">
        {(Object.keys(STATUS_COLORS) as CalendarStatus[]).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 border"
              style={{
                backgroundColor: STATUS_COLORS[s].bg,
                borderColor: STATUS_COLORS[s].border,
                borderRadius: 2,
              }}
            />
            <span className="text-mip-gray-600">{STATUS_LABEL[s]}</span>
          </div>
        ))}
      </div>

      <div
        className="border border-mip-gray-200 overflow-hidden"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        <div className="grid grid-cols-7 bg-mip-gray-50 text-xs uppercase tracking-wider text-mip-gray-500">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-1.5 text-center font-medium">
              {d}
            </div>
          ))}
        </div>

        {grid.weeks.map((week, wi) => (
          <div
            key={wi}
            className="grid grid-cols-7 border-t border-mip-gray-200 relative"
          >
            {week.days.map((day) => {
              const isToday = ymd(day.date) === ymd(today);
              const inMonth = day.date.getMonth() === cursor.getMonth();
              return (
                <div
                  key={day.date.toISOString()}
                  className={`min-h-[6rem] px-1.5 py-1 border-l border-mip-gray-100 first:border-l-0 ${
                    inMonth ? "" : "bg-mip-gray-50/50"
                  }`}
                >
                  <div
                    className={`text-xs ${
                      inMonth ? "text-mip-gray-700" : "text-mip-gray-400"
                    } ${isToday ? "font-bold" : ""}`}
                  >
                    {isToday ? (
                      <span
                        className="inline-flex items-center justify-center w-5 h-5 text-mip-white rounded-full"
                        style={{ backgroundColor: "var(--color-mip-purple)" }}
                      >
                        {day.date.getDate()}
                      </span>
                    ) : (
                      day.date.getDate()
                    )}
                  </div>
                </div>
              );
            })}

            <div className="absolute inset-0 pointer-events-none">
              {week.bars.map((bar, bi) => {
                const colors = STATUS_COLORS[bar.reservation.status];
                const leftPct = (bar.startCol / 7) * 100;
                const widthPct = (bar.span / 7) * 100;
                const topPx = 22 + bar.lane * 20;
                const title = `${bar.reservation.human_id} · ${
                  bar.reservation.requester_name
                }${
                  bar.reservation.organization
                    ? ` (${bar.reservation.organization})`
                    : ""
                } · ${STATUS_LABEL[bar.reservation.status]}`;
                return (
                  <Link
                    key={`${bar.reservation.id}-${bi}`}
                    href={`/admin/spaces/${bar.reservation.human_id}`}
                    className="absolute pointer-events-auto text-xs truncate px-1.5 py-0.5 hover:brightness-95 transition-[filter]"
                    style={{
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      top: topPx,
                      height: 18,
                      backgroundColor: colors.bg,
                      color: colors.text,
                      borderLeft: `3px solid ${colors.border}`,
                      borderRadius: 3,
                      lineHeight: "14px",
                    }}
                    title={title}
                  >
                    {bar.reservation.human_id} · {bar.reservation.requester_name}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs text-mip-gray-500">
        Bars span each event&rsquo;s start through end. Denied and cancelled
        reservations are hidden. Click a bar to open the reservation.
      </p>
    </div>
  );
}

interface DayCell {
  date: Date;
}

interface Bar {
  reservation: CalendarReservation;
  startCol: number;
  span: number;
  lane: number;
}

interface WeekRow {
  days: DayCell[];
  bars: Bar[];
}

interface Grid {
  weeks: WeekRow[];
}

function buildMonthGrid(
  cursor: Date,
  reservations: CalendarReservation[]
): Grid {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);

  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
  const gridEnd = addDays(lastOfMonth, 6 - lastOfMonth.getDay());
  const totalDays = daysBetween(gridStart, gridEnd) + 1;
  const weekCount = totalDays / 7;

  const weeks: WeekRow[] = [];
  for (let w = 0; w < weekCount; w++) {
    const weekStart = addDays(gridStart, w * 7);
    const days: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      days.push({ date: addDays(weekStart, i) });
    }
    weeks.push({ days, bars: [] });
  }

  for (const r of reservations) {
    const start = startOfDay(new Date(r.event_start_at));
    const end = startOfDay(new Date(r.event_end_at));
    if (daysBetween(gridStart, end) < 0) continue;
    if (daysBetween(start, gridEnd) < 0) continue;

    // Clip event range to the visible grid.
    // daysBetween(a, b) is b - a, so `< 0` on (gridStart, start) means
    // start < gridStart (clamp to gridStart); `> 0` on (end, gridEnd)
    // means gridEnd > end (event ends within grid, use event's end).
    const visStart = daysBetween(gridStart, start) < 0 ? gridStart : start;
    const visEnd = daysBetween(end, gridEnd) > 0 ? end : gridEnd;

    let cursorDay = visStart;
    while (daysBetween(cursorDay, visEnd) >= 0) {
      const weekIdx = Math.floor(daysBetween(gridStart, cursorDay) / 7);
      const weekStart = addDays(gridStart, weekIdx * 7);
      const weekEnd = addDays(weekStart, 6);
      // Clip this week's segment to the earlier of (event end, week end).
      const segEnd = daysBetween(visEnd, weekEnd) > 0 ? visEnd : weekEnd;
      const startCol = daysBetween(weekStart, cursorDay);
      const span = daysBetween(cursorDay, segEnd) + 1;
      weeks[weekIdx].bars.push({
        reservation: r,
        startCol,
        span,
        lane: 0,
      });
      cursorDay = addDays(segEnd, 1);
    }
  }

  for (const week of weeks) {
    week.bars.sort((a, b) => a.startCol - b.startCol || b.span - a.span);
    const laneEndCol: number[] = [];
    for (const bar of week.bars) {
      let placed = false;
      for (let lane = 0; lane < laneEndCol.length; lane++) {
        if (laneEndCol[lane] < bar.startCol) {
          bar.lane = lane;
          laneEndCol[lane] = bar.startCol + bar.span - 1;
          placed = true;
          break;
        }
      }
      if (!placed) {
        bar.lane = laneEndCol.length;
        laneEndCol.push(bar.startCol + bar.span - 1);
      }
    }
  }

  return { weeks };
}

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent } from "@/lib/types";
import {
  addDaysYmd,
  groupEventsByDay,
  minutesOfDay,
  monthYearLabel,
  partsInTz,
  timeLabel,
  todayYmd,
  weekDays,
  ymdToDate,
} from "@/lib/calendar-utils";

interface Props {
  events: CalendarEvent[];
  anchorYmd: string;
  onAnchorChange: (ymd: string) => void;
}

// 7 AM to 10 PM by default — covers the vast majority of civic events.
// Anything outside this range gets clamped into the top/bottom slot.
const HOUR_START = 7;
const HOUR_END = 22;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const PX_PER_HOUR = 48;
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;
const GUTTER_PX = 56; // width of the time-label gutter

export function WeekView({ events, anchorYmd, onAnchorChange }: Props) {
  const days = useMemo(() => weekDays(anchorYmd), [anchorYmd]);
  const eventsByDay = useMemo(() => groupEventsByDay(events), [events]);
  const today = todayYmd();

  const firstDate = ymdToDate(days[0]);
  const lastDate = ymdToDate(days[6]);
  const firstParts = partsInTz(firstDate);
  const lastParts = partsInTz(lastDate);
  const rangeLabel =
    firstParts.month === lastParts.month
      ? monthYearLabel(days[0])
      : `${monthYearLabel(days[0])} – ${monthYearLabel(days[6])}`;

  return (
    <div>
      {/* Header controls */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => onAnchorChange(addDaysYmd(anchorYmd, -7))}
          className="p-1.5 border border-mip-gray-300 hover:border-mip-purple transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
          aria-label="Previous week"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onAnchorChange(addDaysYmd(anchorYmd, 7))}
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
          Today
        </button>
        <h2 className="mip-heading text-lg ml-2" style={{ color: "var(--color-mip-purple)" }}>
          {rangeLabel}
        </h2>
      </div>

      {/* Column headers (day names + numbers) */}
      <div
        className="grid border-t border-l border-mip-gray-200 sticky top-16 bg-white z-10"
        style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(7, 1fr)` }}
      >
        <div className="border-r border-b border-mip-gray-200 bg-mip-gray-100" />
        {days.map((ymd) => {
          const [, , dayStr] = ymd.split("-");
          const dayNum = parseInt(dayStr);
          const d = ymdToDate(ymd);
          const wd = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
          }).format(d);
          const isToday = ymd === today;
          return (
            <div
              key={ymd}
              className="border-r border-b border-mip-gray-200 px-2 py-1.5 text-center"
              style={{ backgroundColor: isToday ? "rgba(57, 55, 91, 0.05)" : "white" }}
            >
              <div className="text-[10px] uppercase tracking-wider font-semibold text-mip-gray-600">
                {wd}
              </div>
              <div
                className={`text-lg font-semibold mt-0.5 inline-flex items-center justify-center w-8 h-8 ${
                  isToday ? "bg-mip-purple text-white rounded-full" : ""
                }`}
                style={{
                  color: isToday ? "white" : "var(--color-mip-gray-900)",
                }}
              >
                {dayNum}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div
        className="grid border-l border-mip-gray-200"
        style={{
          gridTemplateColumns: `${GUTTER_PX}px repeat(7, 1fr)`,
          position: "relative",
        }}
      >
        {/* Time gutter column */}
        <div className="border-r border-mip-gray-200 relative" style={{ height: TOTAL_HEIGHT }}>
          {HOURS.slice(0, -1).map((h, i) => (
            <div
              key={h}
              className="absolute right-2 -translate-y-1/2 text-[11px] text-mip-gray-500"
              style={{ top: (i + 1) * PX_PER_HOUR }}
            >
              {formatHour(h + 1)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((ymd) => {
          const dayEvents = eventsByDay.get(ymd) ?? [];
          const isToday = ymd === today;
          return (
            <div
              key={ymd}
              className="border-r border-mip-gray-200 relative"
              style={{
                height: TOTAL_HEIGHT,
                backgroundColor: isToday ? "rgba(57, 55, 91, 0.03)" : "white",
              }}
            >
              {/* Hour lines */}
              {HOURS.slice(0, -1).map((_, i) => (
                <div
                  key={i}
                  className="absolute inset-x-0 border-t border-mip-gray-200"
                  style={{ top: (i + 1) * PX_PER_HOUR }}
                />
              ))}
              {/* Event blocks */}
              {layoutEvents(dayEvents).map((laid) => (
                <EventBlock key={laid.event.id} laid={laid} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface LaidEvent {
  event: CalendarEvent;
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
}

/**
 * Very simple side-by-side overlap layout: compute overlap groups, then
 * within each group assign equal-width columns.
 */
function layoutEvents(dayEvents: CalendarEvent[]): LaidEvent[] {
  // First convert to time boxes
  type Box = { event: CalendarEvent; startMin: number; endMin: number };
  const boxes: Box[] = dayEvents.map((event) => {
    const startMin = minutesOfDay(event.starts_at);
    const rawEndMin = event.ends_at
      ? minutesOfDay(event.ends_at)
      : startMin + 60;
    // If the event ends the next day, cap at 24h
    const endMin = rawEndMin < startMin ? 24 * 60 : rawEndMin;
    return { event, startMin, endMin };
  });

  boxes.sort((a, b) => a.startMin - b.startMin);

  // Assign columns to overlapping events
  interface Assigned extends Box {
    col: number;
    totalCols: number;
  }
  const assigned: Assigned[] = [];
  const clusters: Assigned[][] = [];
  let currentCluster: Assigned[] = [];

  for (const b of boxes) {
    // If current cluster empty, start fresh
    if (currentCluster.length === 0) {
      const a: Assigned = { ...b, col: 0, totalCols: 1 };
      currentCluster.push(a);
      continue;
    }
    // Check if this event overlaps anything in current cluster
    const clusterEnd = Math.max(...currentCluster.map((c) => c.endMin));
    if (b.startMin < clusterEnd) {
      // Overlap: find first free column
      const usedCols = new Set(
        currentCluster.filter((c) => c.endMin > b.startMin).map((c) => c.col)
      );
      let col = 0;
      while (usedCols.has(col)) col++;
      const a: Assigned = { ...b, col, totalCols: 1 };
      currentCluster.push(a);
    } else {
      // Cluster done — commit and start new
      clusters.push(currentCluster);
      currentCluster = [{ ...b, col: 0, totalCols: 1 }];
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  // Set totalCols per cluster
  for (const cluster of clusters) {
    const totalCols = Math.max(...cluster.map((c) => c.col)) + 1;
    for (const c of cluster) c.totalCols = totalCols;
    assigned.push(...cluster);
  }

  const startPx = (min: number) => {
    const clamped = Math.max(min, HOUR_START * 60);
    return ((clamped - HOUR_START * 60) / 60) * PX_PER_HOUR;
  };
  const heightPx = (start: number, end: number) => {
    const s = Math.max(start, HOUR_START * 60);
    const e = Math.min(end, HOUR_END * 60);
    return Math.max(20, ((e - s) / 60) * PX_PER_HOUR);
  };

  return assigned.map((a) => ({
    event: a.event,
    topPx: startPx(a.startMin),
    heightPx: heightPx(a.startMin, a.endMin),
    leftPct: (a.col / a.totalCols) * 100,
    widthPct: 100 / a.totalCols,
  }));
}

function EventBlock({ laid }: { laid: LaidEvent }) {
  const color = laid.event.overlay_calendar?.color ?? "#39375b";
  return (
    <Link
      href={`/e/${laid.event.slug}`}
      className="absolute overflow-hidden hover:brightness-95 transition-all"
      style={{
        top: laid.topPx,
        height: laid.heightPx,
        left: `calc(${laid.leftPct}% + 2px)`,
        width: `calc(${laid.widthPct}% - 4px)`,
        backgroundColor: `${color}22`,
        borderLeft: `3px solid ${color}`,
        borderRadius: "var(--radius-button)",
        padding: "4px 6px",
        fontSize: "11px",
        lineHeight: "1.25",
        color: "var(--color-mip-gray-900)",
      }}
      title={`${laid.event.title} — ${timeLabel(laid.event.starts_at)}`}
    >
      <div className="font-semibold truncate">{laid.event.title}</div>
      {laid.heightPx > 32 && (
        <div className="text-[10px] mip-caption-text mt-0.5">
          {timeLabel(laid.event.starts_at)}
        </div>
      )}
    </Link>
  );
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

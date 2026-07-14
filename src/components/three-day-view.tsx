"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent } from "@/lib/types";
import {
  addDaysYmd,
  groupEventsByDay,
  minutesOfDay,
  partsInTz,
  timeLabel,
  todayYmd,
  ymdToDate,
} from "@/lib/calendar-utils";

interface Props {
  events: CalendarEvent[];
  anchorYmd: string;
  onAnchorChange: (ymd: string) => void;
}

// 7 AM to 10 PM covers civic-event start times comfortably.
// Events outside get clamped to the edges.
const HOUR_START = 7;
const HOUR_END = 22;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const PX_PER_HOUR = 60;
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;
const GUTTER_PX = 52;
const NUM_DAYS = 3;

/**
 * Three-day time-grid view. Anchor points at the leftmost day; arrows
 * scroll one day at a time. Blocks are solid overlay color for high
 * contrast + immediate visual grouping.
 */
export function ThreeDayView({ events, anchorYmd, onAnchorChange }: Props) {
  const days = useMemo(
    () => Array.from({ length: NUM_DAYS }, (_, i) => addDaysYmd(anchorYmd, i)),
    [anchorYmd]
  );
  const eventsByDay = useMemo(() => groupEventsByDay(events), [events]);
  const today = todayYmd();

  // Header label — e.g. "Jul 14 – 16, 2026" or "Jul 30 – Aug 1, 2026"
  const startD = ymdToDate(days[0]);
  const endD = ymdToDate(days[NUM_DAYS - 1]);
  const sameMonth = partsInTz(startD).month === partsInTz(endD).month;
  const tzFmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...opts });
  const startPart = tzFmt({ month: "short", day: "numeric" }).format(startD);
  const endPart = sameMonth
    ? tzFmt({ day: "numeric" }).format(endD)
    : tzFmt({ month: "short", day: "numeric" }).format(endD);
  const yearPart = tzFmt({ year: "numeric" }).format(endD);
  const rangeLabel = `${startPart} – ${endPart}, ${yearPart}`;

  // Current-time indicator
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      const { hour, minute } = partsInTz(new Date());
      const mins = hour * 60 + minute;
      if (mins >= HOUR_START * 60 && mins <= HOUR_END * 60) setNowMinutes(mins);
      else setNowMinutes(null);
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);
  const todayColIdx = days.indexOf(today);
  const showNowLine = todayColIdx >= 0 && nowMinutes !== null;
  const nowLineTop = showNowLine
    ? ((nowMinutes! - HOUR_START * 60) / 60) * PX_PER_HOUR
    : 0;

  // Auto-scroll to just before 9 AM
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gridRef.current) return;
    gridRef.current.scrollTop = Math.max(0, 2 * PX_PER_HOUR - 20);
  }, []);

  return (
    <div>
      {/* Header controls */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          type="button"
          onClick={() => onAnchorChange(addDaysYmd(anchorYmd, -1))}
          className="p-1.5 border border-mip-gray-300 hover:border-mip-purple transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
          aria-label="Previous day"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onAnchorChange(addDaysYmd(anchorYmd, 1))}
          className="p-1.5 border border-mip-gray-300 hover:border-mip-purple transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
          aria-label="Next day"
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

      {/* Column headers */}
      <div
        className="grid border-t border-l border-r border-mip-gray-200 bg-white sticky top-16 z-10"
        style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(${NUM_DAYS}, 1fr)` }}
      >
        <div className="bg-mip-gray-100 border-r border-mip-gray-200" />
        {days.map((ymd, idx) => {
          const [, , dayStr] = ymd.split("-");
          const dayNum = parseInt(dayStr);
          const d = ymdToDate(ymd);
          const wd = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
          }).format(d);
          const month = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            month: "short",
          }).format(d);
          const isToday = ymd === today;
          const isLast = idx === days.length - 1;
          return (
            <div
              key={ymd}
              className={`px-3 py-2 text-center ${isLast ? "" : "border-r"} border-mip-gray-200`}
              style={{ backgroundColor: isToday ? "rgba(57, 55, 91, 0.04)" : "white" }}
            >
              <div className="text-[10px] uppercase tracking-wider font-semibold text-mip-gray-600">
                {wd} · {month}
              </div>
              <div
                className={`text-lg font-semibold mt-1 inline-flex items-center justify-center w-8 h-8 ${
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
        ref={gridRef}
        className="grid border-l border-r border-b border-mip-gray-200 relative overflow-auto"
        style={{
          gridTemplateColumns: `${GUTTER_PX}px repeat(${NUM_DAYS}, 1fr)`,
          maxHeight: "70vh",
        }}
      >
        {/* Gutter */}
        <div
          className="border-r border-mip-gray-200 relative bg-white"
          style={{ height: TOTAL_HEIGHT }}
        >
          {HOURS.map((h, i) => (
            <div
              key={h}
              className="absolute right-2 text-[10px] font-medium text-mip-gray-500 uppercase tracking-wider"
              style={{ top: i * PX_PER_HOUR, transform: "translateY(-0.4em)" }}
            >
              {i === 0 ? "" : formatHour(h)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((ymd, colIdx) => {
          const dayEvents = eventsByDay.get(ymd) ?? [];
          const isToday = ymd === today;
          const isLast = colIdx === days.length - 1;
          return (
            <div
              key={ymd}
              className={`${isLast ? "" : "border-r"} border-mip-gray-200 relative`}
              style={{
                height: TOTAL_HEIGHT,
                backgroundColor: isToday ? "rgba(57, 55, 91, 0.025)" : "white",
              }}
            >
              {/* Hour lines */}
              {HOURS.slice(1).map((_, i) => (
                <div
                  key={i}
                  className="absolute inset-x-0"
                  style={{
                    top: (i + 1) * PX_PER_HOUR,
                    borderTop: "1px solid var(--color-mip-gray-200, #e5e5e5)",
                  }}
                />
              ))}
              {/* Event blocks */}
              {layoutEvents(dayEvents).map((laid) => (
                <EventBlock key={laid.event.id} laid={laid} />
              ))}
              {/* Now line */}
              {isToday && showNowLine && (
                <div
                  className="absolute inset-x-0 pointer-events-none z-20"
                  style={{ top: nowLineTop }}
                >
                  <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
                  <div className="border-t-2 border-red-500" />
                </div>
              )}
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

function layoutEvents(dayEvents: CalendarEvent[]): LaidEvent[] {
  type Box = { event: CalendarEvent; startMin: number; endMin: number };
  const boxes: Box[] = dayEvents.map((event) => {
    const startMin = minutesOfDay(event.starts_at);
    const rawEndMin = event.ends_at ? minutesOfDay(event.ends_at) : startMin + 60;
    const endMin = rawEndMin < startMin ? 24 * 60 : rawEndMin;
    return { event, startMin, endMin };
  });
  boxes.sort((a, b) => a.startMin - b.startMin);

  interface Assigned extends Box {
    col: number;
    totalCols: number;
  }
  const clusters: Assigned[][] = [];
  let currentCluster: Assigned[] = [];
  for (const b of boxes) {
    if (currentCluster.length === 0) {
      currentCluster.push({ ...b, col: 0, totalCols: 1 });
      continue;
    }
    const clusterEnd = Math.max(...currentCluster.map((c) => c.endMin));
    if (b.startMin < clusterEnd) {
      const usedCols = new Set(
        currentCluster.filter((c) => c.endMin > b.startMin).map((c) => c.col)
      );
      let col = 0;
      while (usedCols.has(col)) col++;
      currentCluster.push({ ...b, col, totalCols: 1 });
    } else {
      clusters.push(currentCluster);
      currentCluster = [{ ...b, col: 0, totalCols: 1 }];
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const assigned: Assigned[] = [];
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
    return Math.max(24, ((e - s) / 60) * PX_PER_HOUR);
  };

  return assigned.map((a) => ({
    event: a.event,
    topPx: startPx(a.startMin),
    heightPx: heightPx(a.startMin, a.endMin),
    leftPct: (a.col / a.totalCols) * 100,
    widthPct: 100 / a.totalCols,
  }));
}

/**
 * Solid overlay-color block. Uses WCAG-safe white-on-color for readability,
 * except for very light overlay palettes (fallback: dark text on tinted bg).
 */
function EventBlock({ laid }: { laid: LaidEvent }) {
  const color = laid.event.overlay_calendar?.color ?? "#39375b";
  const useWhiteText = isDark(color);
  const short = laid.heightPx < 48;
  return (
    <Link
      href={`/e/${laid.event.slug}`}
      className="absolute overflow-hidden transition-all hover:brightness-110"
      style={{
        top: laid.topPx + 1,
        height: laid.heightPx - 2,
        left: `calc(${laid.leftPct}% + 2px)`,
        width: `calc(${laid.widthPct}% - 4px)`,
        backgroundColor: color,
        borderRadius: "var(--radius-button)",
        padding: short ? "3px 8px" : "5px 8px",
        fontSize: "12px",
        lineHeight: "1.2",
        color: useWhiteText ? "white" : "#1a1a1a",
        display: "flex",
        flexDirection: "column",
        justifyContent: short ? "center" : "flex-start",
        gap: 2,
        boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
      }}
      title={`${laid.event.title} — ${timeLabel(laid.event.starts_at)}`}
    >
      <div
        className="font-semibold overflow-hidden"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: short ? 1 : 3,
          WebkitBoxOrient: "vertical",
        }}
      >
        {laid.event.title}
      </div>
      {!short && (
        <div
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{ opacity: 0.9 }}
        >
          {timeLabel(laid.event.starts_at)}
        </div>
      )}
    </Link>
  );
}

/** Perceived-luminance check to pick white vs dark text on a colored bg. */
function isDark(hex: string): boolean {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return true;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  // Relative luminance (sRGB)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.6;
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

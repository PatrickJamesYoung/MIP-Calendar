"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// 7 AM to 10 PM — covers the vast majority of civic events.
// Events outside this window still show up clamped to the top/bottom edge.
const HOUR_START = 7;
const HOUR_END = 22;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const PX_PER_HOUR = 56;
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;
const GUTTER_PX = 52;

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

  // Current-time indicator (only visible on today's column, only when today
  // is in the visible week and the current time falls inside the displayed
  // hour range).
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const { hour, minute } = partsInTz(now);
      const mins = hour * 60 + minute;
      if (mins >= HOUR_START * 60 && mins <= HOUR_END * 60) {
        setNowMinutes(mins);
      } else {
        setNowMinutes(null);
      }
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

  // Auto-scroll to a reasonable morning offset if the container is scrollable
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gridRef.current) return;
    // Scroll to just before 9 AM = 2 hours after HOUR_START
    gridRef.current.scrollTop = Math.max(0, 2 * PX_PER_HOUR - 20);
  }, []);

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
        className="grid border-t border-l border-r border-mip-gray-200 bg-white sticky top-16 z-10"
        style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(7, 1fr)` }}
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
          const isToday = ymd === today;
          const isLast = idx === days.length - 1;
          return (
            <div
              key={ymd}
              className={`px-2 py-2 text-center ${isLast ? "" : "border-r"} border-mip-gray-200`}
              style={{ backgroundColor: isToday ? "rgba(57, 55, 91, 0.04)" : "white" }}
            >
              <div className="text-[10px] uppercase tracking-wider font-semibold text-mip-gray-600">
                {wd}
              </div>
              <div
                className={`text-base font-semibold mt-1 inline-flex items-center justify-center w-7 h-7 ${
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
          gridTemplateColumns: `${GUTTER_PX}px repeat(7, 1fr)`,
          maxHeight: "70vh",
        }}
      >
        {/* Time gutter column */}
        <div
          className="border-r border-mip-gray-200 relative bg-white"
          style={{ height: TOTAL_HEIGHT }}
        >
          {HOURS.map((h, i) => (
            <div
              key={h}
              className="absolute right-2 text-[10px] font-medium text-mip-gray-500 uppercase tracking-wider"
              style={{
                top: i * PX_PER_HOUR,
                transform: "translateY(-0.4em)",
              }}
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
              {/* Hour lines - light gray */}
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
              {/* Current-time indicator */}
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

/**
 * Side-by-side overlap layout. Sort by start time, walk through building
 * "clusters" of overlapping events, then within each cluster assign the
 * leftmost free column and distribute the horizontal space equally.
 */
function layoutEvents(dayEvents: CalendarEvent[]): LaidEvent[] {
  type Box = { event: CalendarEvent; startMin: number; endMin: number };
  const boxes: Box[] = dayEvents.map((event) => {
    const startMin = minutesOfDay(event.starts_at);
    const rawEndMin = event.ends_at
      ? minutesOfDay(event.ends_at)
      : startMin + 60;
    const endMin = rawEndMin < startMin ? 24 * 60 : rawEndMin;
    return { event, startMin, endMin };
  });

  boxes.sort((a, b) => a.startMin - b.startMin);

  interface Assigned extends Box {
    col: number;
    totalCols: number;
  }
  const assigned: Assigned[] = [];
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
    return Math.max(22, ((e - s) / 60) * PX_PER_HOUR);
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
  const short = laid.heightPx < 44;
  return (
    <Link
      href={`/e/${laid.event.slug}`}
      className="absolute overflow-hidden hover:brightness-95 transition-all"
      style={{
        top: laid.topPx + 1,
        height: laid.heightPx - 2,
        left: `calc(${laid.leftPct}% + 2px)`,
        width: `calc(${laid.widthPct}% - 4px)`,
        backgroundColor: `${color}22`,
        borderLeft: `3px solid ${color}`,
        borderRadius: "var(--radius-button)",
        padding: short ? "2px 6px" : "4px 6px",
        fontSize: "12px",
        lineHeight: "1.2",
        color: "var(--color-mip-gray-900)",
        display: "flex",
        flexDirection: "column",
        justifyContent: short ? "center" : "flex-start",
        gap: 2,
      }}
      title={`${laid.event.title} — ${timeLabel(laid.event.starts_at)}`}
    >
      <div
        className="font-semibold overflow-hidden"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: short ? 1 : 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {laid.event.title}
      </div>
      {!short && (
        <div className="text-[10px] mip-caption-text opacity-80">
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

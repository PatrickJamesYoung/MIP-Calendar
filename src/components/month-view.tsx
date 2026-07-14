"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { CalendarEvent } from "@/lib/types";
import {
  addMonthsYmd,
  groupEventsByDay,
  monthGridCells,
  monthYearLabel,
  shortDayLabel,
  timeLabel, // used by day popover
  todayYmd,
} from "@/lib/calendar-utils";

interface Props {
  events: CalendarEvent[];
  anchorYmd: string;
  onAnchorChange: (ymd: string) => void;
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({ events, anchorYmd, onAnchorChange }: Props) {
  const cells = useMemo(() => monthGridCells(anchorYmd), [anchorYmd]);
  const eventsByDay = useMemo(() => groupEventsByDay(events), [events]);
  const today = todayYmd();
  const [openDay, setOpenDay] = useState<string | null>(null);

  const openDayEvents = openDay ? eventsByDay.get(openDay) ?? [] : [];

  return (
    <div>
      {/* Header controls */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => onAnchorChange(addMonthsYmd(anchorYmd, -1))}
          className="p-1.5 border border-mip-gray-300 hover:border-mip-purple transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onAnchorChange(addMonthsYmd(anchorYmd, 1))}
          className="p-1.5 border border-mip-gray-300 hover:border-mip-purple transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
          aria-label="Next month"
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
          {monthYearLabel(anchorYmd)}
        </h2>
      </div>

      {/* Weekday header row */}
      <div className="grid grid-cols-7 border-t border-l border-mip-gray-200">
        {WEEKDAY_HEADERS.map((w) => (
          <div
            key={w}
            className="px-2 py-1.5 text-xs uppercase tracking-wider font-semibold text-mip-gray-600 border-r border-b border-mip-gray-200 bg-mip-gray-100"
          >
            {w}
          </div>
        ))}
      </div>

      {/* 6 x 7 grid */}
      <div className="grid grid-cols-7 border-l border-mip-gray-200">
        {cells.map((cell) => {
          const dayEvents = eventsByDay.get(cell.ymd) ?? [];
          const isToday = cell.ymd === today;
          const [, , dayStr] = cell.ymd.split("-");
          const dayNum = parseInt(dayStr);
          const visible = dayEvents.slice(0, 3);
          const overflow = dayEvents.length - visible.length;
          return (
            <div
              key={cell.ymd}
              onClick={() => dayEvents.length > 0 && setOpenDay(cell.ymd)}
              className="border-r border-b border-mip-gray-200 p-1.5 min-h-[90px] md:min-h-[110px] text-xs relative"
              style={{
                backgroundColor: cell.inMonth
                  ? isToday
                    ? "rgba(57, 55, 91, 0.05)"
                    : "white"
                  : "var(--color-mip-gray-100, #f5f5f5)",
                cursor: dayEvents.length > 0 ? "pointer" : "default",
                opacity: cell.inMonth ? 1 : 0.6,
              }}
            >
              <div
                className={`inline-flex items-center justify-center w-6 h-6 text-xs font-semibold ${
                  isToday ? "bg-mip-purple text-white rounded-full" : ""
                }`}
                style={{
                  color: isToday
                    ? "white"
                    : cell.inMonth
                    ? "var(--color-mip-gray-900)"
                    : "var(--color-mip-gray-500)",
                }}
              >
                {dayNum}
              </div>
              <div className="mt-1 space-y-0.5">
                {visible.map((ev) => (
                  <EventPill key={ev.id} event={ev} />
                ))}
                {overflow > 0 && (
                  <div className="text-[10px] font-medium text-mip-gray-600 pl-1">
                    +{overflow} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Day popover */}
      {openDay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpenDay(null)}
        >
          <div
            className="bg-white border border-mip-gray-200 w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl"
            style={{ borderRadius: "var(--radius-button)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-mip-gray-200">
              <div
                className="mip-heading text-lg"
                style={{ color: "var(--color-mip-purple)" }}
              >
                {shortDayLabel(openDay)}
              </div>
              <button
                type="button"
                onClick={() => setOpenDay(null)}
                className="p-1 hover:bg-mip-gray-100"
                style={{ borderRadius: "var(--radius-button)" }}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {openDayEvents.map((ev) => (
                <DayEventRow key={ev.id} event={ev} />
              ))}
              {openDayEvents.length === 0 && (
                <div className="text-sm text-mip-gray-600">No events.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EventPill({ event }: { event: CalendarEvent }) {
  const color = event.overlay_calendar?.color ?? "#39375b";
  return (
    <Link
      href={`/e/${event.slug}`}
      onClick={(e) => e.stopPropagation()}
      className="block truncate px-1.5 py-0.5 text-[11px] leading-tight rounded hover:opacity-80 transition-opacity"
      style={{
        backgroundColor: `${color}1A`, // 10% alpha
        color: "var(--color-mip-gray-900)",
        borderLeft: `3px solid ${color}`,
      }}
      title={`${timeLabel(event.starts_at)} — ${event.title}`}
    >
      {event.title}
    </Link>
  );
}

function DayEventRow({ event }: { event: CalendarEvent }) {
  const color = event.overlay_calendar?.color ?? "#39375b";
  return (
    <Link
      href={`/e/${event.slug}`}
      className="block p-3 border border-mip-gray-200 hover:border-mip-purple transition-colors"
      style={{ borderRadius: "var(--radius-button)", borderLeftColor: color, borderLeftWidth: 4 }}
    >
      <div className="text-xs font-medium mip-caption-text mb-1">
        {timeLabel(event.starts_at)}
        {event.overlay_calendar?.name && (
          <span
            className="ml-2 uppercase tracking-wider"
            style={{ color }}
          >
            {event.overlay_calendar.name}
          </span>
        )}
      </div>
      <div className="font-semibold text-sm">{event.title}</div>
      {event.location_text && (
        <div className="text-xs text-mip-gray-600 mt-1 truncate">
          {event.location_text}
        </div>
      )}
    </Link>
  );
}

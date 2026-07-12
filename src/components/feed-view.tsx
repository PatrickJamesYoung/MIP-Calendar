"use client";

import type { CalendarEvent } from "@/lib/types";
import { EventCard } from "./event-card";
import { groupByDay, dayKeyInTz } from "@/lib/utils";

interface FeedViewProps {
  events: CalendarEvent[];
}

/**
 * Infinite-scroll social-media-style feed of upcoming events.
 * Groups events under sticky date dividers.
 */
export function FeedView({ events }: FeedViewProps) {
  const groups = groupByDay(events);
  const today = dayKeyInTz(new Date().toISOString());
  const tomorrow = dayKeyInTz(new Date(Date.now() + 86400000).toISOString());

  return (
    <div className="space-y-8">
      {groups.map(({ dayKey, events }) => {
        // Parse the YYYY-MM-DD key as a local date at noon to avoid TZ off-by-one.
        const [yy, mm, dd] = dayKey.split("-").map(Number);
        const displayDate = new Date(yy, mm - 1, dd, 12);
        const dayLabel =
          dayKey === today
            ? "TODAY"
            : dayKey === tomorrow
              ? "TOMORROW"
              : displayDate
                  .toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                  .toUpperCase();

        return (
          <section key={dayKey} aria-labelledby={`day-${dayKey}`}>
            <div className="sticky top-[73px] z-10 bg-mip-white/95 backdrop-blur py-2 mb-3 border-b border-mip-gray-200">
              <h2
                id={`day-${dayKey}`}
                className="mip-nav-text"
                style={{ color: "var(--color-mip-purple)" }}
              >
                {dayLabel}
              </h2>
            </div>
            <div className="space-y-4">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </section>
        );
      })}

      {events.length === 0 && (
        <div className="text-center py-16 text-mip-gray-500">
          <p className="mip-heading text-xl mb-2">No upcoming events</p>
          <p className="text-sm">Check back soon or submit an event to get it on the calendar.</p>
        </div>
      )}
    </div>
  );
}

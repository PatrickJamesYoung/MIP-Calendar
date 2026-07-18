"use client";

import type { CalendarEvent } from "@/lib/types";
import { EventCard } from "./event-card";
import { groupByDay, dayKeyInTz } from "@/lib/utils";

interface FeedViewProps {
  events: CalendarEvent[];
}

/**
 * Luma-inspired feed: grouped-by-day rows with a serif day header on the
 * left and event rows to the right. Uses Playfair Display for the day
 * number and Montserrat for everything else.
 */
export function FeedView({ events }: FeedViewProps) {
  const groups = groupByDay(events);
  const today = dayKeyInTz(new Date().toISOString());
  const tomorrow = dayKeyInTz(new Date(Date.now() + 86400000).toISOString());

  return (
    <div className="space-y-10">
      {groups.map(({ dayKey, events }) => {
        // Parse the YYYY-MM-DD key as a local date at noon to avoid TZ off-by-one.
        const [yy, mm, dd] = dayKey.split("-").map(Number);
        const displayDate = new Date(yy, mm - 1, dd, 12);

        const isToday = dayKey === today;
        const isTomorrow = dayKey === tomorrow;

        const dayNumber = displayDate.getDate();
        const weekday = displayDate.toLocaleDateString("en-US", {
          weekday: "long",
        });
        const monthShort = displayDate.toLocaleDateString("en-US", {
          month: "short",
        });

        return (
          <section key={dayKey} aria-labelledby={`day-${dayKey}`}>
            <div className="grid md:grid-cols-[120px_1fr] gap-4 md:gap-8">
              {/* Day header (Luma-style: big serif day number + weekday) */}
              <div className="md:sticky md:top-20 md:self-start">
                <div className="flex md:flex-col items-baseline md:items-start gap-3 md:gap-0 pb-2 md:pb-0 border-b md:border-b-0 border-mip-gray-200">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="mip-display text-4xl md:text-5xl leading-none"
                      style={{ color: "var(--color-mip-black)" }}
                    >
                      {dayNumber}
                    </span>
                    <span
                      className="mip-eyebrow"
                      style={{ color: "var(--color-mip-gray-500)" }}
                    >
                      {monthShort}
                    </span>
                  </div>
                  <div
                    className="text-sm font-semibold mt-0 md:mt-1"
                    style={{ color: "var(--color-mip-purple)" }}
                    id={`day-${dayKey}`}
                  >
                    {isToday ? "Today" : isTomorrow ? "Tomorrow" : weekday}
                  </div>
                </div>
              </div>

              {/* Event rows for this day */}
              <div className="space-y-3">
                {events.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            </div>
          </section>
        );
      })}

      {events.length === 0 && (
        <div className="text-center py-16 text-mip-gray-500">
          <p className="mip-display text-2xl mb-2">No upcoming events</p>
          <p className="text-sm">Check back soon or submit an event to get it on the calendar.</p>
        </div>
      )}
    </div>
  );
}

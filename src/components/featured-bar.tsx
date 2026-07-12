"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import type { CalendarEvent } from "@/lib/types";
import { formatDateBadge, formatTimeRange } from "@/lib/utils";

interface FeaturedBarProps {
  events: CalendarEvent[];
}

/**
 * Horizontal-scrolling bar of MIP-priority events.
 * Auto-hides if there are no featured events currently active.
 */
export function FeaturedBar({ events }: FeaturedBarProps) {
  if (events.length === 0) return null;

  return (
    <section
      aria-label="Priority events"
      className="w-full border-b border-mip-gray-200"
      style={{ backgroundColor: "var(--color-mip-yellow)" }}
    >
      <div
        className="mx-auto px-6 py-3"
        style={{ maxWidth: "var(--max-width-content)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Star
            className="w-4 h-4 fill-mip-purple"
            style={{ color: "var(--color-mip-purple)" }}
          />
          <h2
            className="mip-nav-text"
            style={{ color: "var(--color-mip-purple)" }}
          >
            MIP Priority Events
          </h2>
        </div>

        <div className="flex gap-2 overflow-x-auto mip-scroll-x pb-1.5 -mx-1 px-1 snap-x snap-mandatory">
          {events.map((event) => (
            <FeaturedCard key={event.id} event={event} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedCard({ event }: { event: CalendarEvent }) {
  const badge = formatDateBadge(event.starts_at, event.timezone);
  const time = formatTimeRange(
    event.starts_at,
    event.ends_at,
    event.all_day,
    event.timezone
  );
  const overlay = event.overlay_calendar;

  return (
    <Link
      href={`/e/${event.slug}`}
      className="snap-start shrink-0 w-72 bg-mip-white border border-mip-gray-200 hover:border-mip-purple transition-colors p-2.5 flex gap-2"
      style={{ borderRadius: "var(--radius-button)" }}
    >
      {event.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.image_url}
          alt=""
          className="shrink-0 w-14 h-14 object-cover"
          style={{ borderRadius: "var(--radius-button)" }}
          loading="lazy"
        />
      ) : (
        <div
          className="flex flex-col items-center justify-center shrink-0 w-14 h-14 text-center"
          style={{
            backgroundColor: "var(--color-mip-purple)",
            color: "var(--color-mip-white)",
            borderRadius: "var(--radius-button)",
          }}
        >
          <div className="text-[10px] font-bold leading-none">{badge.month}</div>
          <div className="text-lg font-bold leading-tight">{badge.day}</div>
          <div className="text-[9px] leading-none opacity-80">{badge.weekday}</div>
        </div>
      )}
      <div className="flex-1 min-w-0">
        {overlay && (
          <span
            className="text-[9px] uppercase tracking-wide font-bold inline-flex items-center gap-1 mb-0.5"
            style={{ color: overlay.color }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full inline-block"
              style={{ backgroundColor: overlay.color }}
            />
            {overlay.name}
          </span>
        )}
        <h3 className="mip-heading text-sm leading-tight line-clamp-2">
          {event.title}
        </h3>
        <p className="text-[11px] text-mip-gray-700 mt-0.5 line-clamp-1">
          {badge.month} {badge.day} · {time}
        </p>
      </div>
    </Link>
  );
}

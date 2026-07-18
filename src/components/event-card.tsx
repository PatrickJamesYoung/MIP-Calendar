"use client";

import Link from "next/link";
import { MapPin, Globe, Users, Star } from "lucide-react";
import type { CalendarEvent } from "@/lib/types";
import { formatTimeRange } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface EventCardProps {
  event: CalendarEvent;
  layout?: "feed" | "compact";
}

/**
 * Luma-inspired event row for the Feed view. The day is rendered by
 * FeedView's group header, so this card focuses on: time · title · host ·
 * location, with a small square thumbnail on the right.
 */
export function EventCard({ event, layout = "feed" }: EventCardProps) {
  const time = formatTimeRange(
    event.starts_at,
    event.ends_at,
    event.all_day,
    event.timezone
  );

  const overlay = event.overlay_calendar;
  const locationIcon =
    event.location_type === "online" ? (
      <Globe className="w-3 h-3" />
    ) : event.location_type === "hybrid" ? (
      <Users className="w-3 h-3" />
    ) : (
      <MapPin className="w-3 h-3" />
    );

  return (
    <Link
      href={`/e/${event.slug}`}
      className={cn(
        "group block bg-mip-white overflow-hidden transition-all duration-200",
        layout === "feed" ? "" : "text-sm"
      )}
      style={{
        border: "1px solid var(--color-mip-gray-200)",
        borderRadius: "12px",
      }}
    >
      <div className="flex items-stretch gap-4 p-3 md:p-4">
        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            {/* Time */}
            <div
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--color-mip-gray-700)" }}
            >
              {time}
            </div>

            {/* Title */}
            <h3
              className="text-base md:text-lg font-bold leading-snug line-clamp-2 mb-1"
              style={{
                color: "var(--color-mip-black)",
                fontFamily: "var(--font-sans)",
              }}
            >
              {event.title}
            </h3>

            {/* Host */}
            {event.host_org && (
              <p
                className="text-sm line-clamp-1"
                style={{ color: "var(--color-mip-gray-500)" }}
              >
                {event.host_org}
              </p>
            )}
          </div>

          {/* Bottom meta row */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {event.location_text && (
              <span
                className="inline-flex items-center gap-1 text-xs min-w-0"
                style={{ color: "var(--color-mip-gray-500)" }}
              >
                {locationIcon}
                <span className="line-clamp-1">{event.location_text}</span>
              </span>
            )}

            {/* Chips */}
            <div className="flex items-center flex-wrap gap-1.5">
              {event.is_featured && (
                <span className="mip-priority-badge inline-flex items-center gap-0.5">
                  <Star className="w-2.5 h-2.5 fill-current" />
                  Priority
                </span>
              )}
              {overlay && (
                <span
                  className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 inline-flex items-center gap-1"
                  style={{
                    backgroundColor: `${overlay.color}18`,
                    color: overlay.color,
                    borderRadius: "999px",
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ backgroundColor: overlay.color }}
                  />
                  {overlay.name}
                </span>
              )}
              {event.event_type && (
                <span
                  className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5"
                  style={{
                    backgroundColor: "var(--color-mip-gray-100)",
                    color: "var(--color-mip-gray-700)",
                    borderRadius: "999px",
                  }}
                >
                  {event.event_type.name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right-side square thumbnail */}
        {event.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.image_url}
            alt=""
            className="shrink-0 object-cover w-24 h-24 md:w-32 md:h-32 group-hover:opacity-95 transition-opacity"
            style={{ borderRadius: "8px" }}
            loading="lazy"
          />
        ) : (
          <div
            className="shrink-0 hidden md:flex items-center justify-center w-32 h-32"
            style={{
              backgroundColor: "var(--color-mip-gray-50)",
              borderRadius: "8px",
            }}
            aria-hidden
          />
        )}
      </div>
    </Link>
  );
}

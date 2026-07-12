"use client";

import Link from "next/link";
import { MapPin, Globe, Users, Star } from "lucide-react";
import type { CalendarEvent } from "@/lib/types";
import { formatDateBadge, formatTimeRange } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface EventCardProps {
  event: CalendarEvent;
  layout?: "feed" | "compact";
}

/**
 * Primary event card used in the Feed view.
 * Denser layout with side-thumbnail image (when available) rather than
 * a big hero above — keeps the feed scannable at high density.
 */
export function EventCard({ event, layout = "feed" }: EventCardProps) {
  const badge = formatDateBadge(event.starts_at, event.timezone);
  const time = formatTimeRange(
    event.starts_at,
    event.ends_at,
    event.all_day,
    event.timezone
  );

  const overlay = event.overlay_calendar;
  const borderColor = overlay?.color ?? "#39375b";
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
        "mip-card block overflow-hidden",
        layout === "feed" ? "" : "text-sm"
      )}
      style={{
        borderLeftColor: borderColor,
        borderLeftWidth: "4px",
      }}
    >
      <div className="flex items-start gap-3 p-2.5">
        {/* Date badge */}
        <div
          className="flex flex-col items-center justify-center shrink-0 w-12 h-12 text-center"
          style={{
            backgroundColor: "var(--color-mip-purple)",
            color: "var(--color-mip-white)",
            borderRadius: "var(--radius-button)",
          }}
        >
          <div className="text-[9px] font-bold leading-none uppercase">
            {badge.month}
          </div>
          <div className="text-lg font-bold leading-tight">{badge.day}</div>
          <div className="text-[8px] leading-none opacity-80 uppercase">
            {badge.weekday}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Chip row: priority + overlay + event type */}
          <div className="flex items-center flex-wrap gap-1 mb-1">
            {event.is_featured && (
              <span className="mip-priority-badge shrink-0 inline-flex items-center gap-0.5">
                <Star className="w-2.5 h-2.5 fill-current" />
                Priority
              </span>
            )}
            {overlay && (
              <span
                className="text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1"
                style={{
                  backgroundColor: `${overlay.color}20`,
                  color: overlay.color,
                  borderRadius: "3px",
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
                className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 shrink-0"
                style={{
                  backgroundColor: "var(--color-mip-gray-100)",
                  color: "var(--color-mip-gray-700)",
                  borderRadius: "3px",
                }}
              >
                {event.event_type.name}
              </span>
            )}
          </div>

          <h3 className="mip-heading text-base leading-tight mb-0.5 line-clamp-2">
            {event.title}
          </h3>

          {event.host_org && (
            <p className="text-xs text-mip-gray-700 line-clamp-1">
              {event.host_org}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-mip-gray-500 mt-0.5">
            <span>{time}</span>
            {event.location_text && (
              <span className="inline-flex items-center gap-1 min-w-0">
                {locationIcon}
                <span className="line-clamp-1">{event.location_text}</span>
              </span>
            )}
          </div>

          {event.accessibility && event.accessibility.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {event.accessibility.slice(0, 5).map((feature) => (
                <span
                  key={feature}
                  className="text-[8px] uppercase tracking-wide font-semibold px-1 py-0.5"
                  style={{
                    backgroundColor: "var(--color-mip-cyan)",
                    color: "var(--color-mip-purple)",
                    borderRadius: "2px",
                  }}
                  title={feature.replace(/_/g, " ")}
                >
                  {feature.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right-side thumbnail (event graphic) */}
        {event.image_url && (
          <div
            className="shrink-0 hidden sm:block relative overflow-hidden"
            style={{
              width: "112px",
              height: "112px",
              borderRadius: "var(--radius-button)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.image_url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        )}
      </div>

      {/* Mobile: image goes full-width at the bottom to preserve density */}
      {event.image_url && (
        <div className="sm:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.image_url}
            alt=""
            className="w-full aspect-[16/9] object-cover"
            loading="lazy"
          />
        </div>
      )}
    </Link>
  );
}

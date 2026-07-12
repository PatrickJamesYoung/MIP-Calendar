"use client";

import Link from "next/link";
import Image from "next/image";
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
 * Modernized version of the Trumba tile:
 * - larger, cleaner date badge
 * - hover lift + border color transition
 * - color-coded left border keyed to overlay calendar
 * - inline accessibility icons
 */
export function EventCard({ event, layout = "feed" }: EventCardProps) {
  const badge = formatDateBadge(event.starts_at, event.timezone);
  const time = formatTimeRange(
    event.starts_at,
    event.ends_at,
    event.all_day,
    event.timezone
  );

  const borderColor = event.overlay_calendar?.color ?? "#39375b";
  const locationIcon =
    event.location_type === "online" ? (
      <Globe className="w-3.5 h-3.5" />
    ) : event.location_type === "hybrid" ? (
      <Users className="w-3.5 h-3.5" />
    ) : (
      <MapPin className="w-3.5 h-3.5" />
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
      {event.image_url && layout === "feed" && (
        <div className="relative w-full aspect-[16/9] bg-mip-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.image_url}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className="flex items-start gap-4 p-4">
        {/* Date badge */}
        <div
          className="flex flex-col items-center justify-center shrink-0 w-16 h-16 text-center"
          style={{
            backgroundColor: "var(--color-mip-purple)",
            color: "var(--color-mip-white)",
            borderRadius: "var(--radius-button)",
          }}
        >
          <div className="text-[10px] font-bold leading-none uppercase">
            {badge.month}
          </div>
          <div className="text-2xl font-bold leading-tight">{badge.day}</div>
          <div className="text-[9px] leading-none opacity-80 uppercase">
            {badge.weekday}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 mb-1">
            {event.is_featured && (
              <span className="mip-priority-badge shrink-0 mt-0.5 inline-flex items-center gap-1">
                <Star className="w-3 h-3 fill-current" />
                Priority
              </span>
            )}
            {event.event_type && (
              <span
                className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 shrink-0 mt-0.5"
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

          <h3 className="mip-heading text-lg leading-tight mb-1">
            {event.title}
          </h3>

          {event.host_org && (
            <p className="text-sm text-mip-gray-700 mb-1">{event.host_org}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mip-gray-500">
            <span>{time}</span>
            {event.location_text && (
              <span className="inline-flex items-center gap-1">
                {locationIcon}
                <span className="line-clamp-1">{event.location_text}</span>
              </span>
            )}
          </div>

          {event.accessibility && event.accessibility.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {event.accessibility.slice(0, 4).map((feature) => (
                <span
                  key={feature}
                  className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5"
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
      </div>
    </Link>
  );
}

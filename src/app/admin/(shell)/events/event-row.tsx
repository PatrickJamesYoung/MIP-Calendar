"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Star, Pencil, Trash2 } from "lucide-react";
import type { CalendarEvent, OverlayCalendar } from "@/lib/types";
import { formatDateBadge, formatTimeRange, cn } from "@/lib/utils";
import { deleteEventAction, toggleFeaturedAction } from "./actions";

type Row = Pick<
  CalendarEvent,
  | "id"
  | "title"
  | "slug"
  | "starts_at"
  | "ends_at"
  | "all_day"
  | "timezone"
  | "is_featured"
  | "status"
  | "image_url"
  | "overlay_calendar_id"
> & { overlay_calendar: OverlayCalendar | null };

export function EventRow({ event, isLast }: { event: Row; isLast: boolean }) {
  const [pending, start] = useTransition();

  const badge = formatDateBadge(event.starts_at, event.timezone);
  const time = formatTimeRange(
    event.starts_at,
    event.ends_at,
    event.all_day,
    event.timezone
  );
  const overlay = event.overlay_calendar;

  function toggleFeatured() {
    start(() => toggleFeaturedAction(event.id, !event.is_featured));
  }

  function del() {
    if (!confirm(`Delete "${event.title}"? This can't be undone.`)) return;
    start(() => deleteEventAction(event.id));
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3",
        !isLast && "border-b border-mip-gray-200",
        pending && "opacity-40"
      )}
    >
      <div
        className="shrink-0 w-11 h-11 flex flex-col items-center justify-center text-center"
        style={{
          backgroundColor: "var(--color-mip-purple)",
          color: "var(--color-mip-white)",
          borderRadius: "var(--radius-button)",
        }}
      >
        <div className="text-[8px] font-bold leading-none">{badge.month}</div>
        <div className="text-sm font-bold leading-tight">{badge.day}</div>
      </div>

      {event.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.image_url}
          alt=""
          className="shrink-0 w-11 h-11 object-cover"
          style={{ borderRadius: "var(--radius-button)" }}
          loading="lazy"
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {overlay && (
            <span
              className="text-[9px] uppercase tracking-wide font-bold inline-flex items-center gap-1"
              style={{ color: overlay.color }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: overlay.color }}
              />
              {overlay.name}
            </span>
          )}
          {event.status !== "published" && (
            <span className="text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 bg-mip-gray-200 text-mip-gray-700">
              {event.status}
            </span>
          )}
        </div>
        <h3 className="mip-heading text-sm truncate">{event.title}</h3>
        <p className="text-xs text-mip-gray-700 truncate">
          {badge.weekday}, {badge.month} {badge.day} · {time}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleFeatured}
          disabled={pending}
          title={event.is_featured ? "Remove from featured" : "Add to featured"}
          className={cn(
            "p-2 hover:bg-mip-gray-100 transition-colors",
            event.is_featured && "bg-mip-yellow hover:bg-mip-yellow"
          )}
          style={{ borderRadius: "var(--radius-button)" }}
        >
          <Star
            className={cn("w-4 h-4", event.is_featured && "fill-mip-purple")}
            style={{ color: "var(--color-mip-purple)" }}
          />
        </button>
        <Link
          href={`/admin/events/${event.id}/edit`}
          className="p-2 hover:bg-mip-gray-100 transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          <Pencil className="w-4 h-4 text-mip-gray-700" />
        </Link>
        <button
          type="button"
          onClick={del}
          disabled={pending}
          className="p-2 hover:bg-mip-gray-100 transition-colors"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          <Trash2 className="w-4 h-4" style={{ color: "#c1121f" }} />
        </button>
      </div>
    </div>
  );
}

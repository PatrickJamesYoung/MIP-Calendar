import Link from "next/link";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDateBadge, formatTimeRange } from "@/lib/utils";
import type { CalendarEvent } from "@/lib/types";

// Featured-events embed. Renders only events flagged is_featured=true whose
// featured_until has not passed. Two layouts:
//   /embed/featured           → vertical list (default, ideal for sidebars)
//   /embed/featured?layout=strip → compact horizontal strip
//
// CSP: /embed/:path* is locked to movementinfrastructureproject.org via
// next.config.ts (see /embed base route commit).

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ layout?: string }>;
}

export default async function FeaturedEmbed({ searchParams }: PageProps) {
  const params = await searchParams;
  const layout = params.layout === "strip" ? "strip" : "list";

  const supabase = await createClient();

  const nowIso = new Date().toISOString();

  // Pull featured, published, non-past events. featured_until is null OR
  // in the future. Sort by featured_sort_order (nulls last), then start.
  const { data } = await supabase
    .from("events")
    .select(
      "*, overlay_calendar:overlay_calendars(*), event_type:event_types(*)"
    )
    .eq("status", "published")
    .eq("is_featured", true)
    .gte("starts_at", nowIso)
    .or(`featured_until.is.null,featured_until.gte.${nowIso}`)
    .order("featured_sort_order", { ascending: true, nullsFirst: false })
    .order("starts_at", { ascending: true })
    .limit(30);

  const events = (data ?? []) as CalendarEvent[];

  if (events.length === 0) {
    return <EmptyState />;
  }

  return layout === "strip" ? (
    <StripLayout events={events} />
  ) : (
    <ListLayout events={events} />
  );
}

function EmptyState() {
  return (
    <div className="min-h-[200px] flex items-center justify-center p-6 text-center">
      <p className="text-sm text-mip-gray-500">
        No priority events at the moment. Check back soon.
      </p>
    </div>
  );
}

function SectionHeader() {
  return (
    <div className="flex items-center gap-2 mb-3">
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
  );
}

// -------- Vertical list layout (default) --------

function ListLayout({ events }: { events: CalendarEvent[] }) {
  return (
    <section
      aria-label="Priority events"
      className="w-full"
      style={{ backgroundColor: "var(--color-mip-yellow)" }}
    >
      <div className="mx-auto px-4 py-4" style={{ maxWidth: "640px" }}>
        <SectionHeader />
        <div className="flex flex-col gap-2">
          {events.map((event) => (
            <ListCard key={event.id} event={event} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ListCard({ event }: { event: CalendarEvent }) {
  const badge = formatDateBadge(event.starts_at, event.timezone);
  const time = formatTimeRange(
    event.starts_at,
    event.ends_at,
    event.all_day,
    event.timezone
  );

  return (
    <Link
      href={`https://mip-calendar.vercel.app/e/${event.slug}`}
      target="_top"
      className="bg-mip-white border border-mip-gray-200 hover:border-mip-purple transition-colors p-3 flex gap-3"
      style={{ borderRadius: "var(--radius-button)" }}
    >
      {event.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.image_url}
          alt=""
          className="shrink-0 w-20 h-20 object-cover"
          style={{ borderRadius: "var(--radius-button)" }}
          loading="lazy"
        />
      ) : (
        <div
          className="flex flex-col items-center justify-center shrink-0 w-20 h-20 text-center"
          style={{
            backgroundColor: "var(--color-mip-gray-100)",
            borderRadius: "var(--radius-button)",
          }}
        >
          <div
            className="text-xs uppercase tracking-wide"
            style={{ color: "var(--color-mip-gray-500)" }}
          >
            {badge.month}
          </div>
          <div
            className="text-xl font-bold"
            style={{ color: "var(--color-mip-purple)" }}
          >
            {badge.day}
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h3
          className="font-semibold text-sm leading-snug line-clamp-2 mb-1"
          style={{ color: "var(--color-mip-black)" }}
        >
          {event.title}
        </h3>
        <p
          className="text-xs mb-0.5"
          style={{ color: "var(--color-mip-purple)" }}
        >
          {badge.weekday}, {badge.month} {badge.day} · {time}
        </p>
        {event.location_text && (
          <p
            className="text-xs truncate"
            style={{ color: "var(--color-mip-gray-500)" }}
          >
            {event.location_text}
          </p>
        )}
      </div>
    </Link>
  );
}

// -------- Compact horizontal strip layout --------

function StripLayout({ events }: { events: CalendarEvent[] }) {
  return (
    <section
      aria-label="Priority events"
      className="w-full border-b border-mip-gray-200"
      style={{ backgroundColor: "var(--color-mip-yellow)" }}
    >
      <div className="px-4 py-3">
        <SectionHeader />
        <div className="flex gap-2 overflow-x-auto mip-scroll-x pb-1.5 -mx-1 px-1 snap-x snap-mandatory">
          {events.map((event) => (
            <StripCard key={event.id} event={event} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StripCard({ event }: { event: CalendarEvent }) {
  const badge = formatDateBadge(event.starts_at, event.timezone);
  const time = formatTimeRange(
    event.starts_at,
    event.ends_at,
    event.all_day,
    event.timezone
  );

  return (
    <Link
      href={`https://mip-calendar.vercel.app/e/${event.slug}`}
      target="_top"
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
            backgroundColor: "var(--color-mip-gray-100)",
            borderRadius: "var(--radius-button)",
          }}
        >
          <div
            className="text-[10px] uppercase tracking-wide"
            style={{ color: "var(--color-mip-gray-500)" }}
          >
            {badge.month}
          </div>
          <div
            className="text-base font-bold"
            style={{ color: "var(--color-mip-purple)" }}
          >
            {badge.day}
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h3
          className="font-semibold text-xs leading-snug line-clamp-2 mb-0.5"
          style={{ color: "var(--color-mip-black)" }}
        >
          {event.title}
        </h3>
        <p className="text-[11px]" style={{ color: "var(--color-mip-purple)" }}>
          {badge.weekday} · {time}
        </p>
      </div>
    </Link>
  );
}

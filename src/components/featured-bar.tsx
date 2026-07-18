import Link from "next/link";
import type { CalendarEvent } from "@/lib/types";
import { formatDateBadge, formatTimeRange } from "@/lib/utils";

interface FeaturedBarProps {
  events: CalendarEvent[];
}

/**
 * "Featured Actions" section — Playfair display header + poster-style card
 * grid. Inspired by Free DC's featured actions treatment, in MIP palette
 * (purple/yellow) with Playfair Display headline typography.
 *
 * Auto-hides when there are no active featured events.
 * Shows up to 6 events. Grid: 3-across on desktop, 2 on tablet, 1 on mobile.
 */
export function FeaturedBar({ events }: FeaturedBarProps) {
  if (events.length === 0) return null;

  const featured = events.slice(0, 6);

  return (
    <section
      aria-label="Featured actions"
      className="w-full"
      style={{ backgroundColor: "var(--color-mip-white)" }}
    >
      <div
        className="mx-auto px-6 pt-10 pb-8 md:pt-14 md:pb-10"
        style={{ maxWidth: "var(--max-width-content)" }}
      >
        <div className="text-center mb-8 md:mb-10">
          <div className="mip-eyebrow mb-3">Movement Infrastructure Project</div>
          <h1
            className="mip-display text-4xl md:text-6xl"
            style={{ color: "var(--color-mip-purple)" }}
          >
            Upcoming Events
          </h1>
          <div
            className="mt-4 inline-block px-4 py-1"
            style={{
              backgroundColor: "var(--color-mip-yellow)",
              borderRadius: "9999px",
            }}
          >
            <span
              className="mip-eyebrow"
              style={{
                color: "var(--color-mip-purple)",
                letterSpacing: "0.18em",
              }}
            >
              Featured Actions
            </span>
          </div>
        </div>

        <div className="grid gap-5 md:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((event) => (
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

  return (
    <Link
      href={`/e/${event.slug}`}
      className="group block bg-mip-white overflow-hidden transition-all duration-200"
      style={{
        border: "1px solid var(--color-mip-gray-200)",
        borderRadius: "12px",
      }}
    >
      {/* Poster area with date badge overlay */}
      <div
        className="relative overflow-hidden bg-mip-gray-100"
        style={{ aspectRatio: "3 / 4" }}
      >
        {event.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.image_url}
            alt={event.title}
            className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-mip-purple)" }}
          >
            <div className="text-center px-4">
              <div
                className="mip-display text-3xl mb-1"
                style={{ color: "var(--color-mip-yellow)" }}
              >
                {event.title}
              </div>
            </div>
          </div>
        )}

        {/* Date badge in top-right corner (Free DC signature) */}
        <div
          className="absolute top-3 right-3 flex flex-col items-center justify-center text-center px-2.5 py-1.5"
          style={{
            backgroundColor: "var(--color-mip-white)",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            minWidth: "58px",
          }}
        >
          <div
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--color-mip-purple)" }}
          >
            {badge.month}
          </div>
          <div
            className="mip-display text-2xl leading-none"
            style={{ color: "var(--color-mip-purple)" }}
          >
            {badge.day}
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-4 md:p-5">
        <h3
          className="mip-heading text-lg md:text-xl leading-tight line-clamp-2 mb-2"
          style={{ color: "var(--color-mip-black)" }}
        >
          {event.title}
        </h3>
        <p
          className="text-sm font-medium"
          style={{ color: "var(--color-mip-purple)" }}
        >
          {badge.weekday}, {badge.month} {badge.day} · {time}
        </p>
        {event.location_text && (
          <p
            className="text-sm mt-1 line-clamp-1"
            style={{ color: "var(--color-mip-gray-500)" }}
          >
            {event.location_text}
          </p>
        )}
      </div>
    </Link>
  );
}

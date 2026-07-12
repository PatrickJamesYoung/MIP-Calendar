"use client";

import { useMemo, useState } from "react";
import type { CalendarEvent, OverlayCalendar } from "@/lib/types";
import { FeaturedBar } from "./featured-bar";
import { FeedView } from "./feed-view";
import { OverlayFilter } from "./overlay-filter";

interface CalendarShellProps {
  events: CalendarEvent[];
  overlays: OverlayCalendar[];
}

/**
 * Client wrapper that owns filter state and passes filtered events
 * down to the featured bar and feed view.
 */
export function CalendarShell({ events, overlays }: CalendarShellProps) {
  // Initial visible overlays: those flagged default_visible in the schema.
  const [visibleOverlayIds, setVisibleOverlayIds] = useState<Set<string>>(
    () => new Set(overlays.filter((o) => o.default_visible).map((o) => o.id))
  );

  const toggleOverlay = (id: string) => {
    setVisibleOverlayIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setAllOverlays = (visible: boolean) => {
    setVisibleOverlayIds(visible ? new Set(overlays.map((o) => o.id)) : new Set());
  };

  const filteredEvents = useMemo(() => {
    // If an event has no overlay assigned, show it always (safest default).
    return events.filter(
      (e) => !e.overlay_calendar_id || visibleOverlayIds.has(e.overlay_calendar_id)
    );
  }, [events, visibleOverlayIds]);

  const now = new Date();
  const featuredEvents = useMemo(
    () =>
      filteredEvents
        .filter((e) => {
          if (!e.is_featured) return false;
          if (e.featured_until && new Date(e.featured_until) < now) return false;
          return true;
        })
        .sort((a, b) => {
          const aOrder = a.featured_sort_order ?? 999;
          const bOrder = b.featured_sort_order ?? 999;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.starts_at.localeCompare(b.starts_at);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredEvents]
  );

  return (
    <>
      <FeaturedBar events={featuredEvents} />

      <main
        className="flex-1 mx-auto w-full px-6 py-6"
        style={{ maxWidth: "var(--max-width-content)" }}
      >
        <div className="mb-5">
          <h1
            className="mip-heading text-3xl md:text-4xl mip-double-underline inline-block pb-1.5"
            style={{ color: "var(--color-mip-purple)" }}
          >
            Movement Calendar
          </h1>
          <p className="mt-3 text-sm text-mip-gray-700 max-w-3xl">
            A resource for our community — find ways to plug into actions and events,
            promote your action, and track important dates in our political and economic landscape.
          </p>
        </div>

        <div className="grid md:grid-cols-[240px_1fr] gap-6">
          <aside className="hidden md:block">
            <div className="sticky top-20 space-y-6">
              <OverlayFilter
                overlays={overlays}
                visibleIds={visibleOverlayIds}
                onToggle={toggleOverlay}
                onSetAll={setAllOverlays}
              />
            </div>
          </aside>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <button
                className="mip-button-text px-3 py-1.5 bg-mip-purple text-mip-white"
                style={{ borderRadius: "var(--radius-button)" }}
              >
                Feed
              </button>
              <button
                className="mip-button-text px-3 py-1.5 text-mip-gray-500 hover:bg-mip-gray-100 cursor-not-allowed"
                style={{ borderRadius: "var(--radius-button)" }}
                disabled
                title="Coming soon"
              >
                Day
              </button>
              <button
                className="mip-button-text px-3 py-1.5 text-mip-gray-500 hover:bg-mip-gray-100 cursor-not-allowed"
                style={{ borderRadius: "var(--radius-button)" }}
                disabled
                title="Coming soon"
              >
                Week
              </button>
              <button
                className="mip-button-text px-3 py-1.5 text-mip-gray-500 hover:bg-mip-gray-100 cursor-not-allowed"
                style={{ borderRadius: "var(--radius-button)" }}
                disabled
                title="Coming soon"
              >
                Month
              </button>

              <div className="flex-1" />
              <span className="text-xs text-mip-gray-500">
                {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"}
              </span>
            </div>

            {/* Mobile-only overlay filter (collapsed above the feed) */}
            <details className="md:hidden mb-4 border border-mip-gray-200 rounded p-3">
              <summary className="mip-nav-text cursor-pointer" style={{ color: "var(--color-mip-purple)" }}>
                Filter calendars
              </summary>
              <div className="mt-3">
                <OverlayFilter
                  overlays={overlays}
                  visibleIds={visibleOverlayIds}
                  onToggle={toggleOverlay}
                  onSetAll={setAllOverlays}
                />
              </div>
            </details>

            <FeedView events={filteredEvents} />
          </div>
        </div>
      </main>
    </>
  );
}

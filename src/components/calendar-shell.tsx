"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CalendarEvent, OverlayCalendar } from "@/lib/types";
import { FeaturedBar } from "./featured-bar";
import { FeedView } from "./feed-view";
import { MonthView } from "./month-view";
import { ThreeDayView } from "./three-day-view";
import { WeekView } from "./week-view";
import { OverlayFilter } from "./overlay-filter";
import { todayYmd } from "@/lib/calendar-utils";

interface CalendarShellProps {
  events: CalendarEvent[];
  overlays: OverlayCalendar[];
}

type ViewMode = "feed" | "3day" | "week" | "month";

/**
 * Client wrapper that owns filter + view state and passes filtered events
 * down to the featured bar and the currently selected view.
 */
export function CalendarShell({ events, overlays }: CalendarShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read initial view/anchor from URL so links are shareable
  const initialView = (searchParams.get("view") as ViewMode | null) ?? "feed";
  const initialDate = searchParams.get("date") ?? todayYmd();

  const [view, setView] = useState<ViewMode>(
    ["feed", "3day", "week", "month"].includes(initialView) ? initialView : "feed"
  );
  const [anchorYmd, setAnchorYmd] = useState<string>(initialDate);

  // Sync state back to URL (shallow — doesn't refetch server data)
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "feed") {
      params.delete("view");
      params.delete("date");
    } else {
      params.set("view", view);
      params.set("date", anchorYmd);
    }
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anchorYmd]);

  // Overlay filter state
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

  // Feed view only shows upcoming; grid views show anything the query returned
  const now = new Date();
  const nowIso = now.toISOString();
  const upcomingEvents = useMemo(
    () => filteredEvents.filter((e) => e.starts_at >= nowIso),
    [filteredEvents, nowIso]
  );

  const featuredEvents = useMemo(
    () =>
      upcomingEvents
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
    [upcomingEvents]
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
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <ViewButton current={view} value="feed" onClick={setView}>
                Feed
              </ViewButton>
              <ViewButton current={view} value="3day" onClick={setView}>
                3-Day
              </ViewButton>
              <ViewButton current={view} value="week" onClick={setView}>
                Week
              </ViewButton>
              <ViewButton current={view} value="month" onClick={setView}>
                Month
              </ViewButton>

              <div className="flex-1" />
              <span className="text-xs text-mip-gray-500">
                {view === "feed" ? upcomingEvents.length : filteredEvents.length} event
                {(view === "feed" ? upcomingEvents.length : filteredEvents.length) === 1 ? "" : "s"}
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

            {view === "feed" && <FeedView events={upcomingEvents} />}
            {view === "3day" && (
              <ThreeDayView
                events={filteredEvents}
                anchorYmd={anchorYmd}
                onAnchorChange={setAnchorYmd}
              />
            )}
            {view === "week" && (
              <WeekView
                events={filteredEvents}
                anchorYmd={anchorYmd}
                onAnchorChange={setAnchorYmd}
              />
            )}
            {view === "month" && (
              <MonthView
                events={filteredEvents}
                anchorYmd={anchorYmd}
                onAnchorChange={setAnchorYmd}
              />
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function ViewButton({
  current,
  value,
  onClick,
  children,
}: {
  current: ViewMode;
  value: ViewMode;
  onClick: (v: ViewMode) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className="mip-button-text px-3 py-1.5 transition-colors"
      style={{
        borderRadius: "var(--radius-button)",
        backgroundColor: active ? "var(--color-mip-purple)" : "transparent",
        color: active ? "var(--color-mip-white)" : "var(--color-mip-gray-700)",
      }}
    >
      {children}
    </button>
  );
}

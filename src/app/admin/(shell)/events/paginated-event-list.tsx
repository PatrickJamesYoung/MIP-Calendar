"use client";

import { useState, useTransition } from "react";
import { EventRow } from "./event-row";
import { fetchAdminEventsPage } from "./list-actions";

// Keep the type loose - EventRow already casts to `never`, so shape matches whatever
// the server select() returned.
type EventLike = { id: string } & Record<string, unknown>;

interface Props {
  initialEvents: EventLike[];
  scope: "upcoming" | "past";
  pageSize: number;
  totalCount: number | null;
  dimmed?: boolean;
}

export function PaginatedEventList({
  initialEvents,
  scope,
  pageSize,
  totalCount,
  dimmed = false,
}: Props) {
  const [events, setEvents] = useState<EventLike[]>(initialEvents);
  const [hasMore, setHasMore] = useState(initialEvents.length === pageSize);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    setError(null);
    startTransition(async () => {
      const result = await fetchAdminEventsPage({
        scope,
        offset: events.length,
        pageSize,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEvents((prev) => [...prev, ...(result.rows as EventLike[])]);
      setHasMore(result.hasMore);
    });
  }

  const remaining =
    totalCount !== null ? Math.max(totalCount - events.length, 0) : null;

  return (
    <>
      <div
        className={
          "border border-mip-gray-200" + (dimmed ? " opacity-70" : "")
        }
        style={{ borderRadius: "var(--radius-button)" }}
      >
        {events.map((e, i) => (
          <EventRow
            key={e.id}
            event={e as never}
            isLast={i === events.length - 1}
          />
        ))}
      </div>

      {(hasMore || pending || error) && (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={loadMore}
            disabled={pending || !hasMore}
            className="inline-flex items-center gap-2 px-4 py-2 mip-button-text border border-mip-gray-300 hover:border-mip-purple disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderRadius: "var(--radius-button)" }}
          >
            {pending
              ? "Loading…"
              : hasMore
              ? remaining !== null && remaining > 0
                ? `Show more (${remaining} remaining)`
                : "Show more"
              : "No more events"}
          </button>
          <span className="text-xs text-mip-gray-500">
            Showing {events.length}
            {totalCount !== null ? ` of ${totalCount}` : ""}
          </span>
          {error && (
            <span className="text-xs text-red-700">Error: {error}</span>
          )}
        </div>
      )}
    </>
  );
}

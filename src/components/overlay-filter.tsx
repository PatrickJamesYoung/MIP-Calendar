"use client";

import type { OverlayCalendar } from "@/lib/types";

interface OverlayFilterProps {
  overlays: OverlayCalendar[];
  visibleIds: Set<string>;
  onToggle: (id: string) => void;
  onSetAll: (visible: boolean) => void;
}

/**
 * Sidebar of overlay-calendar toggles.
 * Each row: colored dot, calendar name, count (optional), checkbox-style state.
 * Includes "All / None" quick actions at the top.
 */
export function OverlayFilter({
  overlays,
  visibleIds,
  onToggle,
  onSetAll,
}: OverlayFilterProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3
          className="mip-nav-text"
          style={{ color: "var(--color-mip-purple)" }}
        >
          Calendars
        </h3>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide font-semibold">
          <button
            onClick={() => onSetAll(true)}
            className="hover:underline"
            style={{ color: "var(--color-mip-purple)" }}
          >
            All
          </button>
          <span className="text-mip-gray-300">/</span>
          <button
            onClick={() => onSetAll(false)}
            className="hover:underline text-mip-gray-500"
          >
            None
          </button>
        </div>
      </div>

      <ul className="space-y-1">
        {overlays.map((overlay) => {
          const checked = visibleIds.has(overlay.id);
          return (
            <li key={overlay.id}>
              <label
                className="flex items-center gap-2 cursor-pointer py-1 px-2 -mx-2 rounded hover:bg-mip-gray-50 transition-colors"
                title={overlay.description ?? undefined}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(overlay.id)}
                  className="sr-only peer"
                />
                {/* Custom checkbox that uses the overlay color */}
                <span
                  className="relative flex items-center justify-center w-4 h-4 shrink-0 border-2 transition-all"
                  style={{
                    borderColor: overlay.color,
                    backgroundColor: checked ? overlay.color : "transparent",
                    borderRadius: "3px",
                  }}
                >
                  {checked && (
                    <svg
                      className="w-3 h-3 text-white"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="2 6 5 9 10 3" />
                    </svg>
                  )}
                </span>
                <span
                  className={`text-sm leading-snug ${
                    checked ? "text-mip-black" : "text-mip-gray-500"
                  }`}
                >
                  {overlay.name}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

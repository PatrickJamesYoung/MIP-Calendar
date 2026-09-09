"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  patchReservationField,
  replaceReservationSpaces,
  updateReservationStatus,
} from "../[human_id]/actions";

/**
 * Inline-editable row for the admin spaces queue.
 *
 * Editable directly in the row (no need to click into detail):
 *  - Event title (click to edit, blur to save)
 *  - Staffing organizer (click to edit, blur to save)
 *  - Spaces (button opens a checklist modal → replaces all lines)
 *  - Status (native <select>)
 *
 * Everything else — requester, times, contribution — stays read-only
 * here; the detail page still handles those.
 */

type Status =
  | "tentative"
  | "approved"
  | "denied"
  | "in_use"
  | "completed"
  | "cancelled";

interface Reservation {
  id: string;
  human_id: string;
  status: Status;
  requester_name: string;
  requester_email: string;
  organization: string | null;
  event_title: string | null;
  event_description: string | null;
  staffing_organizer: string | null;
  event_start_at: string;
  event_end_at: string;
  contribution_total: number | null;
}

interface CatalogSpace {
  slug: string;
  name: string;
}

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
};

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "tentative", label: "tentative" },
  { value: "approved", label: "approved" },
  { value: "denied", label: "denied" },
  { value: "in_use", label: "in use" },
  { value: "completed", label: "completed" },
  { value: "cancelled", label: "cancelled" },
];

const STATUS_BADGE_STYLES: Record<Status, string> = {
  tentative: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  in_use: "bg-blue-100 text-blue-800",
  completed: "bg-mip-gray-200 text-mip-gray-700",
  denied: "bg-red-100 text-red-800",
  cancelled: "bg-mip-gray-100 text-mip-gray-500",
};

export function SpaceReservationRow({
  reservation,
  spaceNames,
  catalogSpaces,
}: {
  reservation: Reservation;
  spaceNames: string[];
  catalogSpaces: CatalogSpace[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const [status, setStatus] = useState<Status>(reservation.status);
  const start = new Date(reservation.event_start_at);
  const end = new Date(reservation.event_end_at);
  const contribution = reservation.contribution_total ?? 0;

  // Keep local state in sync when the server component re-renders with
  // updated data (after router.refresh).
  useEffect(() => setStatus(reservation.status), [reservation.status]);

  function handleStatusChange(next: Status) {
    if (next === status) return;
    const previous = status;
    setStatus(next);
    setRowError(null);
    startTransition(async () => {
      const res = await updateReservationStatus({
        reservationId: reservation.id,
        humanId: reservation.human_id,
        status: next,
      });
      if (!res.ok) {
        setStatus(previous);
        setRowError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleFieldSave(
    field: "event_title" | "staffing_organizer",
    value: string
  ) {
    setRowError(null);
    startTransition(async () => {
      const res = await patchReservationField({
        reservationId: reservation.id,
        humanId: reservation.human_id,
        field,
        value,
      });
      if (!res.ok) {
        setRowError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <tr className="border-t border-mip-gray-200 hover:bg-mip-gray-50">
        <td className="px-3 py-2 font-mono text-xs align-top">
          <Link
            href={`/admin/spaces/${reservation.human_id}`}
            className="text-mip-purple hover:underline"
          >
            {reservation.human_id}
          </Link>
        </td>
        <td className="px-3 py-2 align-top">
          <div className="font-medium">{reservation.requester_name}</div>
          <div className="text-xs text-mip-gray-500">
            {reservation.organization ?? "—"} · {reservation.requester_email}
          </div>
        </td>
        <td className="px-3 py-2 max-w-xs align-top">
          <InlineText
            value={reservation.event_title ?? ""}
            placeholder="—"
            onSave={(v) => handleFieldSave("event_title", v)}
            multiline={false}
          />
        </td>
        <td className="px-3 py-2 align-top">
          <InlineText
            value={reservation.staffing_organizer ?? ""}
            placeholder="—"
            onSave={(v) => handleFieldSave("staffing_organizer", v)}
            multiline={false}
          />
        </td>
        <td className="px-3 py-2 whitespace-nowrap text-xs align-top">
          {start.toLocaleString(undefined, DATE_FMT)}
        </td>
        <td className="px-3 py-2 whitespace-nowrap text-xs align-top">
          {end.toLocaleString(undefined, DATE_FMT)}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap align-top">
          ${contribution.toLocaleString()}
        </td>
        <td className="px-3 py-2 align-top">
          <SpacesCell
            reservationId={reservation.id}
            humanId={reservation.human_id}
            spaceNames={spaceNames}
            catalogSpaces={catalogSpaces}
            onError={(e) => setRowError(e)}
          />
        </td>
        <td className="px-3 py-2 align-top">
          <select
            value={status}
            disabled={isPending}
            onChange={(e) => handleStatusChange(e.target.value as Status)}
            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border-0 focus:outline-none focus:ring-2 focus:ring-mip-purple/40 disabled:opacity-60 ${STATUS_BADGE_STYLES[status]}`}
            style={{ borderRadius: "6px" }}
            aria-label="Status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </td>
      </tr>
      {rowError && (
        <tr>
          <td colSpan={9} className="px-3 pb-2 text-xs text-rose-700">
            {rowError}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Click-to-edit single-line text cell. Renders the value as-is (or a
 * placeholder). On click, swaps to an input; on blur or Enter, saves
 * via the passed callback. Escape reverts.
 */
function InlineText({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="block w-full text-left text-sm hover:bg-mip-gray-100 rounded px-1 -mx-1 py-0.5 min-h-[1.5rem]"
        title="Click to edit"
      >
        {value.trim().length > 0 ? (
          <span className="whitespace-pre-wrap break-words">{value}</span>
        ) : (
          <span className="text-mip-gray-400">{placeholder}</span>
        )}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onSave(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="w-full rounded border border-mip-purple/40 bg-white px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
    />
  );
}

/**
 * Displays the list of space names attached to the reservation, and
 * opens a modal picker to replace that list.
 */
function SpacesCell({
  reservationId,
  humanId,
  spaceNames,
  catalogSpaces,
  onError,
}: {
  reservationId: string;
  humanId: string;
  spaceNames: string[];
  catalogSpaces: CatalogSpace[];
  onError: (msg: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Preselect current spaces by matching name → slug. Catalog is the
  // source of truth for what's pickable; a name in the reservation that
  // no longer maps to any active catalog slug can't be re-selected
  // (matches the storefront's behavior when a space is deactivated).
  const nameToSlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of catalogSpaces) m.set(s.name.trim().toLowerCase(), s.slug);
    return m;
  }, [catalogSpaces]);
  const initialSelected = useMemo(() => {
    const set = new Set<string>();
    for (const n of spaceNames) {
      const slug = nameToSlug.get(n.trim().toLowerCase());
      if (slug) set.add(slug);
    }
    return set;
  }, [spaceNames, nameToSlug]);

  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  useEffect(() => {
    if (open) setSelected(new Set(initialSelected));
  }, [open, initialSelected]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await replaceReservationSpaces({
        reservationId,
        humanId,
        spaceSlugs: Array.from(selected),
      });
      if (!res.ok) {
        onError(res.error);
      } else {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full text-left text-sm hover:bg-mip-gray-100 rounded px-1 -mx-1 py-0.5 min-h-[1.5rem]"
        title="Click to change spaces"
      >
        {spaceNames.length === 0 ? (
          <span className="text-mip-gray-400">—</span>
        ) : (
          <span className="whitespace-pre-wrap break-words">
            {spaceNames.join(", ")}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white shadow-xl"
            style={{ borderRadius: "var(--radius-card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-mip-gray-200 px-4 py-3">
              <h3 className="text-sm font-semibold">Edit spaces</h3>
              <p className="mt-1 text-xs text-mip-gray-500">
                Contribution total will be recalculated using the current hours
                billed.
              </p>
            </div>
            <div className="max-h-80 overflow-y-auto px-4 py-3 space-y-1.5">
              {catalogSpaces.length === 0 ? (
                <p className="text-xs text-mip-gray-500">
                  No active spaces in catalog.
                </p>
              ) : (
                catalogSpaces.map((sp) => {
                  const isChecked = selected.has(sp.slug);
                  return (
                    <label
                      key={sp.slug}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-mip-gray-50 px-2 py-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(sp.slug);
                          else next.delete(sp.slug);
                          setSelected(next);
                        }}
                      />
                      <span>{sp.name}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-mip-gray-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="px-3 py-1.5 text-sm text-mip-gray-700 hover:bg-mip-gray-100 rounded disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || selected.size === 0}
                className="px-3 py-1.5 text-sm bg-mip-purple text-white hover:opacity-90 rounded disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

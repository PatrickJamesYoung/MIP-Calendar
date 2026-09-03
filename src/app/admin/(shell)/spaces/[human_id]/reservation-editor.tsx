"use client";

import { useState } from "react";
import { updateReservationFields } from "./actions";

/**
 * Basic single-form editor for a space reservation.
 *
 * Deliberately simple: no accordion, no per-field change tracking, no
 * automated "we changed your event time" emails. That richer flow lives
 * in a future PR. This form updates the reservation row via a single
 * server action and refreshes the page.
 *
 * Line items and computed totals are shown read-only. Rate structure
 * (hours, contribution multiplier) is intentionally not editable here
 * to avoid recomputing the totals in the client — that will land with
 * the full editor.
 */

interface Reservation {
  id: string;
  human_id: string;
  requester_name: string;
  requester_email: string;
  requester_phone: string | null;
  organization: string | null;
  event_description: string | null;
  load_in_at: string;
  event_start_at: string;
  event_end_at: string;
  load_out_at: string;
  hours_billed: number | null;
  subtotal_full: number | null;
  contribution_multiplier: number | null;
  contribution_total: number | null;
  internal_notes: string | null;
  staffing_organizer: string | null;
}

interface Line {
  id: string;
  name_snapshot: string;
  rate_per_hour: number;
  hours_billed: number;
  line_full: number;
}

interface Props {
  reservation: Reservation;
  lines: Line[];
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // datetime-local expects "YYYY-MM-DDTHH:MM"
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReservationEditor({ reservation, lines }: Props) {
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(fd: FormData) {
    setSaving(true);
    setError(null);
    try {
      await updateReservationFields(fd);
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Reservation
      </h2>

      <form action={onSubmit} className="space-y-5">
        <input type="hidden" name="reservation_id" value={reservation.id} />
        <input type="hidden" name="human_id" value={reservation.human_id} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Requester name"
            name="requester_name"
            defaultValue={reservation.requester_name}
          />
          <TextField
            label="Requester email"
            name="requester_email"
            type="email"
            defaultValue={reservation.requester_email}
          />
          <TextField
            label="Phone"
            name="requester_phone"
            defaultValue={reservation.requester_phone ?? ""}
          />
          <TextField
            label="Organization"
            name="organization"
            defaultValue={reservation.organization ?? ""}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Event description
          </label>
          <textarea
            name="event_description"
            defaultValue={reservation.event_description ?? ""}
            rows={3}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TimeField
            label="Load in"
            name="load_in_at"
            defaultValue={toLocalInput(reservation.load_in_at)}
          />
          <TimeField
            label="Event start"
            name="event_start_at"
            defaultValue={toLocalInput(reservation.event_start_at)}
          />
          <TimeField
            label="Event end"
            name="event_end_at"
            defaultValue={toLocalInput(reservation.event_end_at)}
          />
          <TimeField
            label="Load out"
            name="load_out_at"
            defaultValue={toLocalInput(reservation.load_out_at)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Staffing organizer (MIP-only)
          </label>
          <input
            type="text"
            name="staffing_organizer"
            defaultValue={reservation.staffing_organizer ?? ""}
            placeholder="Which MIP organizer is staffing this event?"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Internal notes (organizer-only)
          </label>
          <textarea
            name="internal_notes"
            defaultValue={reservation.internal_notes ?? ""}
            rows={3}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {savedAt && !saving && (
            <span className="text-xs text-emerald-700">Saved</span>
          )}
          {error && <span className="text-xs text-rose-700">{error}</span>}
        </div>
      </form>

      <div className="mt-8">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Spaces on this reservation
        </h3>
        {lines.length === 0 ? (
          <p className="text-sm text-neutral-500">No spaces on this reservation.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="pb-2 font-medium">Space</th>
                <th className="pb-2 text-right font-medium">Rate / hr</th>
                <th className="pb-2 text-right font-medium">Hours</th>
                <th className="pb-2 text-right font-medium">Line total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-neutral-200">
                  <td className="py-2">{l.name_snapshot}</td>
                  <td className="py-2 text-right">
                    ${l.rate_per_hour.toLocaleString()}
                  </td>
                  <td className="py-2 text-right">{l.hours_billed}</td>
                  <td className="py-2 text-right">
                    ${l.line_full.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-300 text-sm">
                <td className="pt-2 font-medium">Subtotal (full rate)</td>
                <td colSpan={3} className="pt-2 text-right">
                  ${Number(reservation.subtotal_full ?? 0).toLocaleString()}
                </td>
              </tr>
              <tr>
                <td className="pt-1 text-xs text-neutral-500">
                  Contribution multiplier
                </td>
                <td colSpan={3} className="pt-1 text-right text-xs text-neutral-500">
                  ×{Number(reservation.contribution_multiplier ?? 1)}
                </td>
              </tr>
              <tr>
                <td className="pt-1 font-medium">Contribution total</td>
                <td colSpan={3} className="pt-1 text-right font-medium">
                  ${Number(reservation.contribution_total ?? 0).toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="mt-3 text-xs text-neutral-500">
          Rate structure, hours billed, and coupon applied are not editable
          here yet. Contact an admin to adjust totals until the full editor
          ships.
        </p>
      </div>
    </section>
  );
}

function TextField({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function TimeField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <input
        type="datetime-local"
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

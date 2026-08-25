"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateReservationCoreFields,
  updateReservationDates,
  updateReservationTier,
  updateReservationLine,
  deleteReservationLine,
  addReservationLine,
} from "./edit-actions";

/**
 * Client-side editor for a gear reservation.
 *
 * Rendered inside the LEFT column of the reservation detail page. Owns
 * three logical sections: organizer + logistics fields, line items,
 * and tier/multiplier. Each section is a small collapsed summary that
 * expands into an edit form. On save, each form posts to its dedicated
 * server action.
 *
 * The "notify organizer" checkbox is shared UI: it appears once at the
 * top of the editor and threads through every save. That way the
 * organizer only has to make the "should we ping them?" decision once
 * per edit session, not once per field.
 */

interface Reservation {
  id: string;
  human_id: string;
  requester_name: string;
  requester_email: string;
  requester_phone: string | null;
  organization: string | null;
  org_tier: string | null;
  event_description: string | null;
  pickup_at: string;
  return_at: string;
  pickup_location: string | null;
  subtotal_full: number;
  contribution_multiplier: number;
  contribution_total: number;
  coupon_code: string | null;
  internal_notes: string | null;
}

interface Line {
  id: string;
  name_snapshot: string;
  category: string | null;
  quantity: number;
  unit_contribution: number;
  line_full: number;
  follow_up_answer: string | null;
}

interface CatalogItem {
  id: string;
  name: string;
  category: string | null;
  suggested_contribution: number;
  quantity_total: number;
}

interface TierChoice {
  key: string; // "full" | "mid" | "low"
  label: string;
  multiplier: number;
}

interface Props {
  reservation: Reservation;
  lines: Line[];
  catalog: CatalogItem[];
  tierChoices: TierChoice[];
}

function formatMoney(n: number | null): string {
  return `$${Number(n ?? 0).toFixed(2)}`;
}

function formatDateForInput(iso: string): string {
  // <input type="datetime-local"> expects "YYYY-MM-DDTHH:mm" in the
  // control's local time. We treat the stored UTC timestamp as ET
  // wall-clock so the admin sees the same time the organizer sees.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(iso)).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function ReservationEditor({
  reservation,
  lines,
  catalog,
  tierChoices,
}: Props) {
  const router = useRouter();
  const [notify, setNotify] = useState(false);
  // All four sections start expanded so the admin sees every piece of
  // the reservation at a glance. The Section header still toggles a
  // single section closed when the admin wants to focus on one thing.
  type SectionKey = "core" | "dates" | "tier" | "lines";
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(
    () => new Set<SectionKey>(["lines", "dates", "tier", "core"])
  );
  function toggleSection(key: SectionKey) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {/* Notify banner */}
      <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          <div>
            <div className="font-medium text-sky-900">
              Notify organizer of changes
            </div>
            <div className="text-xs text-sky-800">
              When on, saving any edit below emails{" "}
              <span className="font-mono">{reservation.requester_email}</span>{" "}
              a summary of what changed. Turn off for silent fixups.
            </div>
          </div>
        </label>
      </div>

      <LineItemsSection
        reservation={reservation}
        lines={lines}
        catalog={catalog}
        notify={notify}
        open={openSections.has("lines")}
        onToggle={() => toggleSection("lines")}
        onChange={() => router.refresh()}
      />

      <DatesSection
        reservation={reservation}
        notify={notify}
        open={openSections.has("dates")}
        onToggle={() => toggleSection("dates")}
      />

      <TierSection
        reservation={reservation}
        tierChoices={tierChoices}
        notify={notify}
        open={openSections.has("tier")}
        onToggle={() => toggleSection("tier")}
      />

      <CoreFieldsSection
        reservation={reservation}
        notify={notify}
        open={openSections.has("core")}
        onToggle={() => toggleSection("core")}
      />
    </div>
  );
}

// ─────────────── Section shell ───────────────

function Section({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            {title}
          </h2>
          {!open && (
            <div className="mt-1 text-sm text-neutral-800">{summary}</div>
          )}
        </div>
        <span className="text-xs text-neutral-500">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && <div className="border-t px-5 py-4">{children}</div>}
    </section>
  );
}

// ─────────────── Core fields ───────────────

function CoreFieldsSection({
  reservation,
  notify,
  open,
  onToggle,
}: {
  reservation: Reservation;
  notify: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const summary = (
    <span>
      {reservation.requester_name}
      {reservation.organization ? ` · ${reservation.organization}` : ""} ·{" "}
      <span className="font-mono text-neutral-600">
        {reservation.requester_email}
      </span>
    </span>
  );
  return (
    <Section
      title="Organizer & event"
      summary={summary}
      open={open}
      onToggle={onToggle}
    >
      <form action={updateReservationCoreFields} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="reservation_id" value={reservation.id} />
        <input type="hidden" name="human_id" value={reservation.human_id} />
        {notify && (
          <input type="hidden" name="notify_organizer" value="on" />
        )}
        <Field
          label="Name"
          name="requester_name"
          defaultValue={reservation.requester_name}
          required
        />
        <Field
          label="Email"
          name="requester_email"
          type="email"
          defaultValue={reservation.requester_email}
          required
        />
        <Field
          label="Phone"
          name="requester_phone"
          defaultValue={reservation.requester_phone ?? ""}
        />
        <Field
          label="Organization"
          name="organization"
          defaultValue={reservation.organization ?? ""}
        />
        <div className="sm:col-span-2">
          <TextArea
            label="Event description"
            name="event_description"
            defaultValue={reservation.event_description ?? ""}
            rows={3}
          />
        </div>
        <Field
          label="Pickup location"
          name="pickup_location"
          defaultValue={reservation.pickup_location ?? ""}
          placeholder="e.g. Petworth UMC basement"
        />
        <Field
          label="Coupon"
          name="coupon_code"
          defaultValue={reservation.coupon_code ?? ""}
        />
        <div className="sm:col-span-2">
          <TextArea
            label="Internal notes (organizer-only)"
            name="internal_notes"
            defaultValue={reservation.internal_notes ?? ""}
            rows={3}
            placeholder="Not sent to requester. Not emailed on change."
          />
        </div>
        <div className="sm:col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onToggle} className="text-sm text-neutral-500 hover:text-neutral-900">
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Save
          </button>
        </div>
      </form>
    </Section>
  );
}

// ─────────────── Dates ───────────────

function DatesSection({
  reservation,
  notify,
  open,
  onToggle,
}: {
  reservation: Reservation;
  notify: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const summary = (
    <span>
      Pickup {new Date(reservation.pickup_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })}{" "}
      → return{" "}
      {new Date(reservation.return_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })}
      {" ET"}
    </span>
  );
  return (
    <Section
      title="Pickup / return"
      summary={summary}
      open={open}
      onToggle={onToggle}
    >
      <form action={updateReservationDates} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="reservation_id" value={reservation.id} />
        <input type="hidden" name="human_id" value={reservation.human_id} />
        {notify && (
          <input type="hidden" name="notify_organizer" value="on" />
        )}
        <DateField
          label="Pickup (ET)"
          name="pickup_at"
          defaultValue={formatDateForInput(reservation.pickup_at)}
        />
        <DateField
          label="Return (ET)"
          name="return_at"
          defaultValue={formatDateForInput(reservation.return_at)}
        />
        <div className="sm:col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onToggle} className="text-sm text-neutral-500 hover:text-neutral-900">
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Save dates
          </button>
        </div>
      </form>
    </Section>
  );
}

// ─────────────── Tier ───────────────

function TierSection({
  reservation,
  tierChoices,
  notify,
  open,
  onToggle,
}: {
  reservation: Reservation;
  tierChoices: TierChoice[];
  notify: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const currentTier = tierChoices.find(
    (t) => t.key === reservation.org_tier
  );
  const summary = (
    <span>
      {currentTier?.label ?? reservation.org_tier ?? "—"} ·{" "}
      {reservation.contribution_multiplier}× ·{" "}
      <span className="font-medium">
        {formatMoney(reservation.contribution_total)}
      </span>
    </span>
  );

  const [selected, setSelected] = useState<string>(
    reservation.org_tier ?? tierChoices[0]?.key ?? ""
  );
  const [multiplier, setMultiplier] = useState<string>(
    String(reservation.contribution_multiplier)
  );

  function onTierChange(next: string) {
    setSelected(next);
    const t = tierChoices.find((x) => x.key === next);
    if (t) setMultiplier(String(t.multiplier));
  }

  return (
    <Section
      title="Tier & multiplier"
      summary={summary}
      open={open}
      onToggle={onToggle}
    >
      <form action={updateReservationTier} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="reservation_id" value={reservation.id} />
        <input type="hidden" name="human_id" value={reservation.human_id} />
        {notify && (
          <input type="hidden" name="notify_organizer" value="on" />
        )}
        <label className="block text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Tier
          </div>
          <select
            name="org_tier"
            value={selected}
            onChange={(e) => onTierChange(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            {tierChoices.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} ({t.multiplier}×)
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Multiplier
          </div>
          <input
            type="number"
            step="0.05"
            min="0"
            max="5"
            name="contribution_multiplier"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm tabular-nums"
          />
          <div className="mt-1 text-xs text-neutral-500">
            Preview:{" "}
            <span className="font-medium">
              {formatMoney(
                reservation.subtotal_full * (Number(multiplier) || 0)
              )}
            </span>
          </div>
        </label>
        <div className="sm:col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onToggle} className="text-sm text-neutral-500 hover:text-neutral-900">
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Save tier
          </button>
        </div>
      </form>
    </Section>
  );
}

// ─────────────── Line items ───────────────

function LineItemsSection({
  reservation,
  lines,
  catalog,
  notify,
  open,
  onToggle,
  onChange,
}: {
  reservation: Reservation;
  lines: Line[];
  catalog: CatalogItem[];
  notify: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: () => void;
}) {
  const totalItems = lines.reduce((n, l) => n + l.quantity, 0);
  const summary = (
    <span>
      {totalItems} item{totalItems === 1 ? "" : "s"} across {lines.length}{" "}
      line{lines.length === 1 ? "" : "s"} ·{" "}
      <span className="font-medium">
        {formatMoney(reservation.subtotal_full)}
      </span>{" "}
      subtotal
    </span>
  );

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Items in the catalog not already on this reservation (to avoid dup
  // rows when adding). This is a soft check — the DB allows duplicate
  // lines for the same item, which is useful for e.g. two separate
  // half-day blocks.
  const availableToAdd = useMemo(() => {
    return catalog
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog]);

  const [addItemId, setAddItemId] = useState<string>("");
  const [addQty, setAddQty] = useState<string>("1");

  function doUpdate(
    line: Line,
    patch: Partial<Pick<Line, "quantity" | "unit_contribution">>
  ) {
    setError(null);
    startTransition(async () => {
      const res = await updateReservationLine({
        reservationId: reservation.id,
        humanId: reservation.human_id,
        lineId: line.id,
        quantity: Number(patch.quantity ?? line.quantity),
        unitContribution: Number(
          patch.unit_contribution ?? line.unit_contribution
        ),
        notifyOrganizer: notify,
      });
      if (!res.ok) setError(res.error);
      else onChange();
    });
  }

  function doDelete(line: Line) {
    if (!confirm(`Remove ${line.name_snapshot} from this reservation?`))
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteReservationLine({
        reservationId: reservation.id,
        humanId: reservation.human_id,
        lineId: line.id,
        notifyOrganizer: notify,
      });
      if (!res.ok) setError(res.error);
      else onChange();
    });
  }

  function doAdd() {
    if (!addItemId) {
      setError("Pick an item first");
      return;
    }
    const qty = Number(addQty);
    if (!Number.isFinite(qty) || qty < 1) {
      setError("Quantity must be ≥ 1");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addReservationLine({
        reservationId: reservation.id,
        humanId: reservation.human_id,
        itemId: addItemId,
        quantity: qty,
        notifyOrganizer: notify,
      });
      if (!res.ok) setError(res.error);
      else {
        setAddItemId("");
        setAddQty("1");
        onChange();
      }
    });
  }

  return (
    <Section
      title="Requested items"
      summary={summary}
      open={open}
      onToggle={onToggle}
    >
      {error && (
        <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="pb-2 pr-4 font-medium">Item</th>
            <th className="pb-2 pr-4 text-right font-medium">Qty</th>
            <th className="pb-2 pr-4 text-right font-medium">Unit</th>
            <th className="pb-2 pr-4 text-right font-medium">Line total</th>
            <th className="pb-2 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <LineRow
              key={l.id}
              line={l}
              disabled={pending}
              onSave={(patch) => doUpdate(l, patch)}
              onDelete={() => doDelete(l)}
            />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="pt-3 text-right text-neutral-500">
              Subtotal
            </td>
            <td className="pt-3 text-right tabular-nums font-medium">
              {formatMoney(reservation.subtotal_full)}
            </td>
            <td></td>
          </tr>
          <tr>
            <td
              colSpan={3}
              className="pt-1 text-right text-neutral-500"
            >
              Contribution ({reservation.contribution_multiplier}×)
            </td>
            <td className="pt-1 text-right tabular-nums font-semibold">
              {formatMoney(reservation.contribution_total)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      {/* Add-line row */}
      <div className="mt-4 border-t pt-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Add item
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select
            value={addItemId}
            onChange={(e) => setAddItemId(e.target.value)}
            className="flex-1 min-w-[220px] rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="">— pick an item —</option>
            {availableToAdd.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name} ({formatMoney(it.suggested_contribution)}
                {it.category ? ` · ${it.category}` : ""})
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            value={addQty}
            onChange={(e) => setAddQty(e.target.value)}
            className="w-20 rounded-md border border-neutral-300 px-3 py-2 text-sm tabular-nums"
          />
          <button
            type="button"
            onClick={doAdd}
            disabled={pending || !addItemId}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </Section>
  );
}

function LineRow({
  line,
  disabled,
  onSave,
  onDelete,
}: {
  line: Line;
  disabled: boolean;
  onSave: (patch: Partial<Pick<Line, "quantity" | "unit_contribution">>) => void;
  onDelete: () => void;
}) {
  const [qty, setQty] = useState<string>(String(line.quantity));
  const [unit, setUnit] = useState<string>(
    Number(line.unit_contribution).toFixed(2)
  );
  const dirty =
    Number(qty) !== line.quantity ||
    Number(unit) !== Number(line.unit_contribution);

  return (
    <tr className="border-b border-neutral-100 align-top">
      <td className="py-2 pr-4">
        <div>{line.name_snapshot}</div>
        {line.category && (
          <div className="text-xs text-neutral-500">{line.category}</div>
        )}
        {line.follow_up_answer && (
          <div className="mt-1 text-xs text-neutral-600">
            <span className="text-neutral-500">Note: </span>
            {line.follow_up_answer}
          </div>
        )}
      </td>
      <td className="py-2 pr-4 text-right">
        <input
          type="number"
          min="1"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-16 rounded-md border border-neutral-300 px-2 py-1 text-right text-sm tabular-nums"
        />
      </td>
      <td className="py-2 pr-4 text-right">
        <input
          type="number"
          step="0.01"
          min="0"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-right text-sm tabular-nums"
        />
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">
        {formatMoney(Number(qty) * Number(unit))}
      </td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-1">
          {dirty && (
            <button
              type="button"
              onClick={() =>
                onSave({
                  quantity: Number(qty),
                  unit_contribution: Number(unit),
                })
              }
              disabled={disabled}
              className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Save
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            title="Remove"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─────────────── Field primitives ───────────────

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </div>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function TextArea({
  label,
  name,
  defaultValue,
  rows = 3,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function DateField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <input
        type="datetime-local"
        name={name}
        defaultValue={defaultValue}
        required
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

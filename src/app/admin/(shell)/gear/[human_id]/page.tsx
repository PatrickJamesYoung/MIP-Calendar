import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateReservationFields } from "./actions";
import { ReservationActions } from "./reservation-actions";

export const dynamic = "force-dynamic";

type Status =
  | "tentative"
  | "approved"
  | "denied"
  | "picked_up"
  | "returned"
  | "cancelled";

interface Reservation {
  id: string;
  human_id: string;
  status: Status;
  requester_name: string;
  requester_email: string;
  requester_phone: string | null;
  organization: string | null;
  org_tier: string | null;
  event_description: string | null;
  pickup_at: string;
  return_at: string;
  pickup_location: string | null;
  subtotal_full: number | null;
  contribution_multiplier: number | null;
  contribution_total: number | null;
  coupon_code: string | null;
  acknowledged_tentative: boolean | null;
  internal_notes: string | null;
  created_at: string;
}

interface Line {
  id: string;
  name_snapshot: string;
  category_snapshot: string | null;
  quantity: number;
  unit_contribution: number | null;
  line_full: number | null;
}

interface Activity {
  id: string;
  actor_email: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

function statusBadge(status: Status) {
  const map: Record<Status, { label: string; className: string }> = {
    tentative: { label: "Tentative", className: "bg-amber-100 text-amber-900 border-amber-300" },
    approved: { label: "Approved", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
    denied: { label: "Denied", className: "bg-rose-100 text-rose-900 border-rose-300" },
    picked_up: { label: "Picked up", className: "bg-sky-100 text-sky-900 border-sky-300" },
    returned: { label: "Returned", className: "bg-slate-100 text-slate-900 border-slate-300" },
    cancelled: { label: "Cancelled", className: "bg-neutral-100 text-neutral-700 border-neutral-300" },
  };
  const s = map[status] ?? map.tentative;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}

export default async function GearReservationDetail(props: {
  params: Promise<{ human_id: string }>;
}) {
  const { human_id } = await props.params;
  await requireAdmin();

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("gear_reservations")
    .select("*")
    .eq("human_id", human_id)
    .maybeSingle();

  if (!reservation) return notFound();
  const r = reservation as Reservation;

  const [linesRes, activityRes] = await Promise.all([
    supabase
      .from("gear_reservation_lines")
      .select("id,name_snapshot,category_snapshot,quantity,unit_contribution,line_full")
      .eq("reservation_id", r.id),
    supabase
      .from("gear_activity")
      .select("id,actor_email,action,detail,created_at")
      .eq("reservation_id", r.id)
      .order("created_at", { ascending: false }),
  ]);
  const linesData = (linesRes.data ?? []) as Line[];
  const activityData = (activityRes.data ?? []) as Activity[];

  const totalItems = linesData.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Breadcrumb */}
      <div className="mb-4 text-sm">
        <Link
          href="/admin/gear"
          className="text-neutral-500 hover:text-neutral-900"
        >
          ← Gear queue
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {r.human_id}
            </h1>
            {statusBadge(r.status)}
          </div>
          <p className="text-sm text-neutral-600">
            {r.requester_name}
            {r.organization ? ` · ${r.organization}` : ""} — submitted{" "}
            {formatDate(r.created_at)}
          </p>
        </div>
        <ReservationActions
          reservationId={r.id}
          humanId={r.human_id}
          status={r.status}
          requesterEmail={r.requester_email}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT: line items + event details */}
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Requested items">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="pb-2 pr-4 font-medium">Item</th>
                  <th className="pb-2 pr-4 font-medium">Category</th>
                  <th className="pb-2 pr-4 text-right font-medium">Qty</th>
                  <th className="pb-2 pr-4 text-right font-medium">Unit</th>
                  <th className="pb-2 text-right font-medium">Line total</th>
                </tr>
              </thead>
              <tbody>
                {linesData.map((l) => (
                  <tr key={l.id} className="border-b border-neutral-100">
                    <td className="py-2 pr-4">{l.name_snapshot}</td>
                    <td className="py-2 pr-4 text-neutral-600">
                      {l.category_snapshot ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {l.quantity}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      ${Number(l.unit_contribution ?? 0).toFixed(2)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      ${Number(l.line_full ?? 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="pt-3 text-neutral-500">
                    {totalItems} item{totalItems === 1 ? "" : "s"}
                  </td>
                  <td></td>
                  <td className="pt-3 text-right text-neutral-500">Subtotal</td>
                  <td className="pt-3 text-right tabular-nums">
                    ${Number(r.subtotal_full ?? 0).toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} className="pt-1 text-right text-neutral-500">
                    Contribution ({r.contribution_multiplier ?? 1}×)
                  </td>
                  <td className="pt-1 text-right font-medium tabular-nums">
                    ${Number(r.contribution_total ?? 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Panel>

          <EventPanel r={r} />

          <NotesPanel r={r} />
        </div>

        {/* RIGHT: organizer + activity */}
        <div className="space-y-6">
          <Panel title="Organizer">
            <dl className="space-y-2 text-sm">
              <Row label="Name" value={r.requester_name} />
              <Row
                label="Email"
                value={
                  <a
                    href={`mailto:${r.requester_email}`}
                    className="text-sky-700 hover:underline"
                  >
                    {r.requester_email}
                  </a>
                }
              />
              {r.requester_phone && (
                <Row label="Phone" value={r.requester_phone} />
              )}
              {r.organization && <Row label="Org" value={r.organization} />}
              {r.org_tier && (
                <Row
                  label="Tier"
                  value={<span className="capitalize">{r.org_tier}</span>}
                />
              )}
              {r.coupon_code && <Row label="Coupon" value={r.coupon_code} />}
              {r.acknowledged_tentative && (
                <Row label="Acknowledged tentative" value="Yes" />
              )}
            </dl>
          </Panel>

          <Panel title="Activity">
            {activityData.length === 0 ? (
              <p className="text-sm text-neutral-500">No activity yet.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {activityData.map((a) => (
                  <li
                    key={a.id}
                    className="border-l-2 border-neutral-200 pl-3"
                  >
                    <div className="font-medium">{actionLabel(a.action)}</div>
                    <div className="text-xs text-neutral-500">
                      {a.actor_email ?? "system"} · {formatDate(a.created_at)}
                    </div>
                    {a.detail && <ActivityDetail detail={a.detail} />}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ─────────────── Small helpers ───────────────

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-neutral-900">{value}</dd>
    </div>
  );
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    approved: "Approved",
    denied: "Denied",
    picked_up: "Marked picked up",
    returned: "Marked returned",
    cancelled: "Cancelled",
    status_changed: "Status changed",
    email_sent: "Email sent",
    email_resent: "Email resent",
    fields_updated: "Fields updated",
  };
  return map[action] ?? action;
}

function ActivityDetail({ detail }: { detail: Record<string, unknown> }) {
  const email = detail.email as { ok?: boolean; error?: string } | undefined;
  const template = detail.template as string | undefined;
  const reason = detail.reason as string | undefined;
  const fields = detail.fields as string[] | undefined;
  const status = detail.status as string | undefined;

  const parts: string[] = [];
  if (status) parts.push(`→ ${status}`);
  if (template) parts.push(`template: ${template}`);
  if (email) {
    parts.push(
      email.ok ? "email sent ✓" : `email failed: ${email.error ?? "unknown"}`
    );
  }
  if (reason) parts.push(`reason: ${reason}`);
  if (fields) parts.push(`fields: ${fields.join(", ")}`);
  if (parts.length === 0) return null;

  return (
    <div className="mt-1 text-xs text-neutral-600">{parts.join(" · ")}</div>
  );
}

// ─────────────── Editable panels ───────────────

function EventPanel({ r }: { r: Reservation }) {
  return (
    <Panel title="Event & logistics">
      <form
        action={updateReservationFields}
        className="grid gap-4 sm:grid-cols-2"
      >
        <input type="hidden" name="reservation_id" value={r.id} />
        <input type="hidden" name="human_id" value={r.human_id} />

        <div className="sm:col-span-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Event description
          </div>
          <div className="whitespace-pre-wrap rounded-md bg-neutral-50 px-3 py-2 text-sm">
            {r.event_description || <span className="text-neutral-400">—</span>}
          </div>
        </div>

        <ReadOnly label="Pickup" value={formatDate(r.pickup_at)} />
        <ReadOnly label="Return" value={formatDate(r.return_at)} />

        <Field
          label="Organizer name"
          name="requester_name"
          defaultValue={r.requester_name ?? ""}
          placeholder="e.g. Liz Hohenberger"
        />
        <Field
          label="Organizer phone"
          name="requester_phone"
          defaultValue={r.requester_phone ?? ""}
          placeholder="e.g. 555-123-4567"
        />

        <div className="sm:col-span-2">
          <Field
            label="Pickup location"
            name="pickup_location"
            defaultValue={r.pickup_location ?? ""}
            placeholder="e.g. Petworth UMC basement"
          />
        </div>

        <div className="sm:col-span-2 flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Save event details
          </button>
        </div>
      </form>
    </Panel>
  );
}

function NotesPanel({ r }: { r: Reservation }) {
  return (
    <Panel title="Internal notes (organizer-only)">
      <form action={updateReservationFields}>
        <input type="hidden" name="reservation_id" value={r.id} />
        <input type="hidden" name="human_id" value={r.human_id} />
        <textarea
          name="internal_notes"
          rows={4}
          defaultValue={r.internal_notes ?? ""}
          placeholder="Not sent to requester. Organizer-only context."
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Save notes
          </button>
        </div>
      </form>
    </Panel>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="block text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm">{value}</div>
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReservationActions } from "./reservation-actions";
import { ReservationEditor } from "./reservation-editor";
import { EmailsPanel } from "./emails-panel";

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
  quantity: number;
  unit_contribution: number | null;
  line_full: number | null;
  follow_up_answer: string | null;
  gear_items: { category: string | null }[] | { category: string | null } | null;
}

interface CatalogItem {
  id: string;
  name: string;
  category: string | null;
  suggested_contribution: number;
  quantity_total: number;
}

interface SettingRow {
  key: string;
  value: unknown;
}

interface Activity {
  id: string;
  actor_email: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface EmailMessage {
  id: string;
  direction: "outbound" | "inbound";
  transport: "gmail" | "resend";
  subject: string;
  body_text: string;
  body_html: string | null;
  from_address: string;
  to_address: string;
  template_key: string | null;
  actor_email: string | null;
  sent_at: string | null;
  received_at: string | null;
  error: string | null;
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

function lineCategory(l: Line): string | null {
  const gi = l.gear_items;
  if (!gi) return null;
  if (Array.isArray(gi)) return gi[0]?.category ?? null;
  return gi.category ?? null;
}

function statusBadge(status: Status) {
  const map: Record<Status, { label: string; className: string }> = {
    tentative: {
      label: "Tentative",
      className: "bg-amber-100 text-amber-900 border-amber-300",
    },
    approved: {
      label: "Approved",
      className: "bg-emerald-100 text-emerald-900 border-emerald-300",
    },
    denied: {
      label: "Denied",
      className: "bg-rose-100 text-rose-900 border-rose-300",
    },
    picked_up: {
      label: "Picked up",
      className: "bg-sky-100 text-sky-900 border-sky-300",
    },
    returned: {
      label: "Returned",
      className: "bg-slate-100 text-slate-900 border-slate-300",
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-neutral-100 text-neutral-700 border-neutral-300",
    },
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

  const [linesRes, activityRes, catalogRes, settingsRes, emailsRes] =
    await Promise.all([
      supabase
        .from("gear_reservation_lines")
        .select(
          "id,name_snapshot,quantity,unit_contribution,line_full,follow_up_answer,gear_items(category)"
        )
        .eq("reservation_id", r.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("gear_activity")
        .select("id,actor_email,action,detail,created_at")
        .eq("reservation_id", r.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("gear_items")
        .select("id,name,category,suggested_contribution,quantity_total")
        .eq("active", true)
        .order("name", { ascending: true }),
      supabase
        .from("gear_settings")
        .select("key,value")
        .in("key", [
          "tier_full_label",
          "tier_mid_label",
          "tier_low_label",
          "tier_full_multiplier",
          "tier_mid_multiplier",
          "tier_low_multiplier",
        ]),
      supabase
        .from("gear_email_messages")
        .select(
          "id,direction,transport,subject,body_text,body_html,from_address,to_address,template_key,actor_email,sent_at,received_at,error,created_at"
        )
        .eq("reservation_id", r.id)
        .order("created_at", { ascending: false }),
    ]);
  const linesData = (linesRes.data ?? []) as Line[];
  const activityData = (activityRes.data ?? []) as Activity[];
  const catalogData = (catalogRes.data ?? []) as CatalogItem[];
  const settingsData = (settingsRes.data ?? []) as SettingRow[];
  const emailsData = (emailsRes.data ?? []) as EmailMessage[];

  const settingMap = new Map(settingsData.map((s) => [s.key, s.value]));
  const tierChoices = [
    {
      key: "full",
      label:
        (settingMap.get("tier_full_label") as string) ??
        "Well-resourced organization",
      multiplier: Number(settingMap.get("tier_full_multiplier") ?? 1),
    },
    {
      key: "mid",
      label:
        (settingMap.get("tier_mid_label") as string) ??
        "Small organization or coalition",
      multiplier: Number(settingMap.get("tier_mid_multiplier") ?? 0.85),
    },
    {
      key: "low",
      label:
        (settingMap.get("tier_low_label") as string) ??
        "Volunteer group or individual",
      multiplier: Number(settingMap.get("tier_low_multiplier") ?? 0.65),
    },
  ];

  // Flatten line category so the editor doesn't need to know how Supabase
  // renders a foreign-key relation.
  const editorLines = linesData.map((l) => ({
    id: l.id,
    name_snapshot: l.name_snapshot,
    category: lineCategory(l),
    quantity: l.quantity,
    unit_contribution: Number(l.unit_contribution ?? 0),
    line_full: Number(l.line_full ?? 0),
    follow_up_answer: l.follow_up_answer,
  }));

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
        {/* LEFT: editable reservation */}
        <div className="space-y-6 lg:col-span-2">
          <ReservationEditor
            reservation={{
              id: r.id,
              human_id: r.human_id,
              requester_name: r.requester_name,
              requester_email: r.requester_email,
              requester_phone: r.requester_phone,
              organization: r.organization,
              org_tier: r.org_tier,
              event_description: r.event_description,
              pickup_at: r.pickup_at,
              return_at: r.return_at,
              pickup_location: r.pickup_location,
              subtotal_full: Number(r.subtotal_full ?? 0),
              contribution_multiplier: Number(r.contribution_multiplier ?? 1),
              contribution_total: Number(r.contribution_total ?? 0),
              coupon_code: r.coupon_code,
              internal_notes: r.internal_notes,
            }}
            lines={editorLines}
            catalog={catalogData}
            tierChoices={tierChoices}
          />
        </div>

        {/* RIGHT: read-only organizer summary + activity */}
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

          <EmailsPanel emails={emailsData} />
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
    reservation_edited: "Reservation edited",
  };
  return map[action] ?? action;
}

function ActivityDetail({ detail }: { detail: Record<string, unknown> }) {
  const email = detail.email as { ok?: boolean; error?: string } | undefined;
  const template = detail.template as string | undefined;
  const reason = detail.reason as string | undefined;
  const fields = detail.fields as string[] | undefined;
  const status = detail.status as string | undefined;
  const notified = detail.notified as boolean | undefined;
  const changes = detail.changes as
    | Array<{
        field: string;
        label: string;
        before: string | null;
        after: string | null;
      }>
    | undefined;

  return (
    <div className="mt-1 space-y-1 text-xs text-neutral-600">
      {status && <div>→ {status}</div>}
      {template && <div>template: {template}</div>}
      {email && (
        <div>
          {email.ok
            ? notified
              ? "organizer notified ✓"
              : "email sent ✓"
            : `email failed: ${email.error ?? "unknown"}`}
        </div>
      )}
      {reason && <div>reason: {reason}</div>}
      {fields && <div>fields: {fields.join(", ")}</div>}
      {changes && changes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {changes.map((c, i) => (
            <li key={i}>
              <span className="font-medium text-neutral-800">{c.label}:</span>{" "}
              <span className="text-neutral-500">{c.before ?? "—"}</span>{" "}
              <span className="text-neutral-400">→</span>{" "}
              <span className="text-neutral-800">{c.after ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

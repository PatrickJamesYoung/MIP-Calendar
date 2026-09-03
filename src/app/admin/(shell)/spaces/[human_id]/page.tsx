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
  | "in_use"
  | "completed"
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
  load_in_at: string;
  event_start_at: string;
  event_end_at: string;
  load_out_at: string;
  hours_billed: number | null;
  subtotal_full: number | null;
  contribution_multiplier: number | null;
  contribution_total: number | null;
  coupon_code: string | null;
  acknowledged_tentative: boolean | null;
  internal_notes: string | null;
  staffing_organizer: string | null;
  equipment_requested: string[] | null;
  created_at: string;
}

interface Line {
  id: string;
  name_snapshot: string;
  rate_per_hour: number | null;
  hours_billed: number | null;
  line_full: number | null;
}

interface Activity {
  id: string;
  actor_email: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface SpaceEmailMessage {
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
    in_use: {
      label: "In use",
      className: "bg-sky-100 text-sky-900 border-sky-300",
    },
    completed: {
      label: "Completed",
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

export default async function SpaceReservationDetail(props: {
  params: Promise<{ human_id: string }>;
}) {
  const { human_id } = await props.params;
  await requireAdmin();

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("spaces_reservations")
    .select("*")
    .eq("human_id", human_id)
    .maybeSingle();

  if (!reservation) return notFound();
  const r = reservation as Reservation;

  const [linesRes, activityRes, emailsRes] = await Promise.all([
    supabase
      .from("spaces_reservation_lines")
      .select("id,name_snapshot,rate_per_hour,hours_billed,line_full")
      .eq("reservation_id", r.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("spaces_activity")
      .select("id,actor_email,action,detail,created_at")
      .eq("reservation_id", r.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("spaces_email_messages")
      .select(
        "id,direction,transport,subject,body_text,body_html,from_address,to_address,template_key,actor_email,sent_at,received_at,error,created_at"
      )
      .eq("reservation_id", r.id)
      .order("created_at", { ascending: false }),
  ]);
  const linesData = (linesRes.data ?? []) as Line[];
  const activityData = (activityRes.data ?? []) as Activity[];
  const emailsData = (emailsRes.data ?? []) as SpaceEmailMessage[];

  const editorLines = linesData.map((l) => ({
    id: l.id,
    name_snapshot: l.name_snapshot,
    rate_per_hour: Number(l.rate_per_hour ?? 0),
    hours_billed: Number(l.hours_billed ?? 0),
    line_full: Number(l.line_full ?? 0),
  }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4 text-sm">
        <Link
          href="/admin/spaces"
          className="text-neutral-500 hover:text-neutral-900"
        >
          ← Spaces queue
        </Link>
      </div>

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
        <div className="space-y-6 lg:col-span-2">
          <ReservationEditor
            reservation={{
              id: r.id,
              human_id: r.human_id,
              requester_name: r.requester_name,
              requester_email: r.requester_email,
              requester_phone: r.requester_phone,
              organization: r.organization,
              event_description: r.event_description,
              load_in_at: r.load_in_at,
              event_start_at: r.event_start_at,
              event_end_at: r.event_end_at,
              load_out_at: r.load_out_at,
              hours_billed: Number(r.hours_billed ?? 0),
              subtotal_full: Number(r.subtotal_full ?? 0),
              contribution_multiplier: Number(r.contribution_multiplier ?? 1),
              contribution_total: Number(r.contribution_total ?? 0),
              internal_notes: r.internal_notes,
              staffing_organizer: r.staffing_organizer,
            }}
            lines={editorLines}
          />
        </div>

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

          {r.equipment_requested && r.equipment_requested.length > 0 && (
            <Panel title="Equipment requested">
              <ul className="list-disc pl-5 text-sm text-neutral-800 space-y-1">
                {r.equipment_requested.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Panel>
          )}

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
    in_use: "Marked in use",
    completed: "Marked completed",
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

  return (
    <div className="mt-1 space-y-1 text-xs text-neutral-600">
      {status && <div>→ {status}</div>}
      {template && <div>template: {template}</div>}
      {email && (
        <div>
          {email.ok ? "email sent ✓" : `email failed: ${email.error ?? "unknown"}`}
        </div>
      )}
      {reason && <div>reason: {reason}</div>}
      {fields && <div>fields: {fields.join(", ")}</div>}
    </div>
  );
}

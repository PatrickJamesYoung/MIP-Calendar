import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmissionRow } from "./submission-row";

export const dynamic = "force-dynamic";

interface SubmissionRecord {
  id: string;
  submitter_name: string;
  submitter_email: string;
  submitter_phone: string | null;
  event_payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  admin_notes: string | null;
  decided_at: string | null;
  published_event_id: string | null;
  created_at: string;
}

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = params.status === "all" ? null : (params.status ?? "pending");

  const supabase = createAdminClient();
  const query = supabase
    .from("submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter) query.eq("status", filter);
  const { data } = await query;

  const submissions = (data ?? []) as SubmissionRecord[];

  // Counts for filter tabs
  const { count: pendingCount } = await supabase
    .from("submissions")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  const { count: approvedCount } = await supabase
    .from("submissions")
    .select("*", { count: "exact", head: true })
    .eq("status", "approved");
  const { count: rejectedCount } = await supabase
    .from("submissions")
    .select("*", { count: "exact", head: true })
    .eq("status", "rejected");

  // Get overlay + event_type names for pretty display
  const { data: overlays } = await supabase
    .from("overlay_calendars")
    .select("id, name");
  const { data: eventTypes } = await supabase
    .from("event_types")
    .select("id, name");
  const overlayById = new Map((overlays ?? []).map((o) => [o.id, o.name]));
  const eventTypeById = new Map((eventTypes ?? []).map((t) => [t.id, t.name]));

  return (
    <div>
      <h1
        className="mip-heading text-2xl mip-double-underline inline-block pb-1"
        style={{ color: "var(--color-mip-purple)" }}
      >
        Submissions
      </h1>

      {/* Filter tabs */}
      <div className="mt-6 flex items-center gap-2 flex-wrap">
        <FilterTab href="/admin/submissions" label="Pending" count={pendingCount ?? 0} active={filter === "pending"} />
        <FilterTab href="/admin/submissions?status=approved" label="Approved" count={approvedCount ?? 0} active={filter === "approved"} />
        <FilterTab href="/admin/submissions?status=rejected" label="Rejected" count={rejectedCount ?? 0} active={filter === "rejected"} />
        <FilterTab href="/admin/submissions?status=all" label="All" count={(pendingCount ?? 0) + (approvedCount ?? 0) + (rejectedCount ?? 0)} active={filter === null} />
      </div>

      {/* List */}
      {submissions.length === 0 ? (
        <div className="mt-8 p-8 border border-dashed border-mip-gray-300 text-center">
          <p className="text-mip-gray-500">
            {filter === "pending"
              ? "No pending submissions. New submissions from the public form will show up here."
              : `No ${filter ?? ""} submissions.`}
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {submissions.map((sub) => (
            <SubmissionRow
              key={sub.id}
              submission={sub}
              overlayName={
                overlayById.get(
                  (sub.event_payload.overlay_calendar_id as string | null) ??
                    ""
                ) ?? null
              }
              eventTypeName={
                eventTypeById.get(
                  (sub.event_payload.event_type_id as string | null) ?? ""
                ) ?? null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterTab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 px-3 py-1.5 mip-button-text transition-colors ${
        active
          ? "bg-mip-purple text-mip-white"
          : "text-mip-gray-700 hover:bg-mip-gray-100"
      }`}
      style={{ borderRadius: "var(--radius-button)" }}
    >
      <span>{label}</span>
      <span
        className={`text-xs px-1.5 rounded ${
          active ? "bg-white/20" : "bg-mip-gray-200 text-mip-gray-700"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

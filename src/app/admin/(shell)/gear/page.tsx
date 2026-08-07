import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { GearReservationRow } from "./_components/gear-reservation-row";

export const dynamic = "force-dynamic";

interface ReservationRecord {
  id: string;
  human_id: string;
  status: "tentative" | "approved" | "denied" | "picked_up" | "returned" | "cancelled";
  requester_name: string;
  requester_email: string;
  requester_phone: string | null;
  organization: string | null;
  org_tier: string | null;
  event_description: string | null;
  pickup_at: string;
  return_at: string;
  contribution_total: number | null;
  created_at: string;
}

interface LineCountRow {
  reservation_id: string;
}

const STATUS_ORDER: Array<ReservationRecord["status"]> = [
  "tentative",
  "approved",
  "picked_up",
  "returned",
  "denied",
  "cancelled",
];

const PAGE_SIZE = 25;

export default async function AdminGearPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter =
    params.status === "all"
      ? null
      : ((params.status ?? "tentative") as ReservationRecord["status"]);
  const search = (params.q ?? "").trim();
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = createAdminClient();

  // Reservations query
  let query = supabase
    .from("gear_reservations")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (filter) query = query.eq("status", filter);
  if (search) {
    // Case-insensitive across human_id, name, email, org
    const like = `%${search}%`;
    query = query.or(
      [
        `human_id.ilike.${like}`,
        `requester_name.ilike.${like}`,
        `requester_email.ilike.${like}`,
        `organization.ilike.${like}`,
      ].join(",")
    );
  }

  const { data: reservations, count: totalCount } = await query;
  const rows = (reservations ?? []) as ReservationRecord[];

  // Line counts for the rows on this page
  const reservationIds = rows.map((r) => r.id);
  let lineCountByReservation = new Map<string, number>();
  if (reservationIds.length > 0) {
    const { data: lines } = await supabase
      .from("gear_reservation_lines")
      .select("reservation_id")
      .in("reservation_id", reservationIds);
    for (const line of (lines ?? []) as LineCountRow[]) {
      lineCountByReservation.set(
        line.reservation_id,
        (lineCountByReservation.get(line.reservation_id) ?? 0) + 1
      );
    }
  }

  // Counts per status (for filter tabs)
  const statusCounts = await Promise.all(
    STATUS_ORDER.map(async (s) => {
      const { count } = await supabase
        .from("gear_reservations")
        .select("*", { count: "exact", head: true })
        .eq("status", s);
      return [s, count ?? 0] as const;
    })
  );
  const countsByStatus = new Map(statusCounts);
  const totalAllStatuses = statusCounts.reduce((sum, [, c]) => sum + c, 0);

  // KPI strip: this month + next 7 days
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [{ count: thisMonthCount }, { count: nextSevenCount }] =
    await Promise.all([
      supabase
        .from("gear_reservations")
        .select("*", { count: "exact", head: true })
        .gte("pickup_at", firstOfMonth.toISOString())
        .lt("pickup_at", firstOfNextMonth.toISOString()),
      supabase
        .from("gear_reservations")
        .select("*", { count: "exact", head: true })
        .gte("pickup_at", now.toISOString())
        .lt("pickup_at", sevenDaysOut.toISOString())
        .in("status", ["tentative", "approved", "picked_up"]),
    ]);

  const totalPages = Math.max(
    1,
    Math.ceil((totalCount ?? 0) / PAGE_SIZE)
  );

  return (
    <div>
      <h1
        className="mip-heading text-2xl mip-double-underline inline-block pb-1"
        style={{ color: "var(--color-mip-purple)" }}
      >
        Gear
      </h1>
      <p className="mt-1 text-sm text-mip-gray-600">
        Reservation queue for the MIP gear library.
      </p>

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Tentative" value={countsByStatus.get("tentative") ?? 0} />
        <Kpi label="Approved" value={countsByStatus.get("approved") ?? 0} />
        <Kpi label="This month" value={thisMonthCount ?? 0} />
        <Kpi label="Next 7 days" value={nextSevenCount ?? 0} />
      </div>

      {/* Filter tabs */}
      <div className="mt-6 flex items-center gap-2 flex-wrap">
        {STATUS_ORDER.map((s) => (
          <FilterTab
            key={s}
            href={buildHref(s, search)}
            label={labelForStatus(s)}
            count={countsByStatus.get(s) ?? 0}
            active={filter === s}
          />
        ))}
        <FilterTab
          href={buildHref("all", search)}
          label="All"
          count={totalAllStatuses}
          active={filter === null}
        />
      </div>

      {/* Search */}
      <form className="mt-4 flex items-center gap-2" action="/admin/gear" method="get">
        {filter && <input type="hidden" name="status" value={filter} />}
        {!filter && <input type="hidden" name="status" value="all" />}
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search by ID, name, email, or org"
          className="flex-1 md:max-w-sm px-3 py-1.5 text-sm border border-mip-gray-300 focus:outline-none focus:border-mip-purple"
          style={{ borderRadius: "var(--radius-button)" }}
        />
        <button
          type="submit"
          className="px-3 py-1.5 mip-button-text bg-mip-gray-100 text-mip-gray-700 hover:bg-mip-gray-200"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          Search
        </button>
        {search && (
          <Link
            href={buildHref(filter ?? "all", "")}
            className="text-xs text-mip-gray-500 hover:text-mip-gray-700 underline"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Results */}
      {rows.length === 0 ? (
        <div className="mt-8 p-8 border border-dashed border-mip-gray-300 text-center">
          <p className="text-mip-gray-500">
            {search
              ? `No reservations match "${search}".`
              : filter === "tentative"
                ? "No tentative reservations. New requests from the storefront will show up here."
                : `No ${filter ?? ""} reservations.`}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 border border-mip-gray-200" style={{ borderRadius: "var(--radius-card)" }}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-mip-gray-500 bg-mip-gray-50">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Requester</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Pickup</th>
                  <th className="px-3 py-2 font-medium">Return</th>
                  <th className="px-3 py-2 font-medium text-right">Contribution</th>
                  <th className="px-3 py-2 font-medium text-center">Items</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <GearReservationRow
                    key={r.id}
                    reservation={r}
                    lineCount={lineCountByReservation.get(r.id) ?? 0}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-mip-gray-500">
                Page {page} of {totalPages} · {totalCount} total
              </span>
              <div className="flex items-center gap-2">
                <PageLink
                  href={buildHref(filter ?? "all", search, page - 1)}
                  label="Previous"
                  disabled={page <= 1}
                />
                <PageLink
                  href={buildHref(filter ?? "all", search, page + 1)}
                  label="Next"
                  disabled={page >= totalPages}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function labelForStatus(s: ReservationRecord["status"]): string {
  switch (s) {
    case "tentative":
      return "Tentative";
    case "approved":
      return "Approved";
    case "picked_up":
      return "Picked up";
    case "returned":
      return "Returned";
    case "denied":
      return "Denied";
    case "cancelled":
      return "Cancelled";
  }
}

function buildHref(
  status: string,
  search: string,
  page?: number
): string {
  const p = new URLSearchParams();
  if (status && status !== "tentative") p.set("status", status);
  if (search) p.set("q", search);
  if (page && page > 1) p.set("page", String(page));
  const q = p.toString();
  return q ? `/admin/gear?${q}` : "/admin/gear";
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="border border-mip-gray-200 p-3"
      style={{ borderRadius: "var(--radius-card)" }}
    >
      <div className="text-xs uppercase tracking-wider text-mip-gray-500">
        {label}
      </div>
      <div className="mt-1 text-2xl mip-heading" style={{ color: "var(--color-mip-purple)" }}>
        {value}
      </div>
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

function PageLink({
  href,
  label,
  disabled,
}: {
  href: string;
  label: string;
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <span
        className="inline-flex items-center px-3 py-1 text-sm text-mip-gray-400 border border-mip-gray-200"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center px-3 py-1 text-sm text-mip-gray-700 border border-mip-gray-300 hover:bg-mip-gray-100"
      style={{ borderRadius: "var(--radius-button)" }}
    >
      {label}
    </Link>
  );
}

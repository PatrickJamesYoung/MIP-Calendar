import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SpaceReservationRow } from "./_components/space-reservation-row";
import {
  SpaceReservationsCalendar,
  type CalendarReservation,
  type CalendarStatus,
} from "./_components/space-reservations-calendar";

export const dynamic = "force-dynamic";

interface ReservationRecord {
  id: string;
  human_id: string;
  status:
    | "tentative"
    | "approved"
    | "denied"
    | "in_use"
    | "completed"
    | "cancelled";
  requester_name: string;
  requester_email: string;
  requester_phone: string | null;
  organization: string | null;
  event_description: string | null;
  load_in_at: string;
  event_start_at: string;
  event_end_at: string;
  load_out_at: string;
  contribution_total: number | null;
  created_at: string;
}

interface LineCountRow {
  reservation_id: string;
}

const STATUS_ORDER: Array<ReservationRecord["status"]> = [
  "tentative",
  "approved",
  "in_use",
  "completed",
  "denied",
  "cancelled",
];

const CALENDAR_STATUSES: CalendarStatus[] = [
  "tentative",
  "approved",
  "in_use",
  "completed",
];

type SortKey = "created" | "event_start" | "event_end";
type SortDir = "asc" | "desc";

const SORT_COLUMN: Record<SortKey, string> = {
  created: "created_at",
  event_start: "event_start_at",
  event_end: "event_end_at",
};

const PAGE_SIZE = 25;

export default async function AdminSpacesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    page?: string;
    sort?: string;
    dir?: string;
  }>;
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

  const sortKey: SortKey =
    params.sort === "event_start" || params.sort === "event_end"
      ? params.sort
      : "created";
  const defaultDir: SortDir = sortKey === "created" ? "desc" : "asc";
  const sortDir: SortDir =
    params.dir === "asc" || params.dir === "desc"
      ? (params.dir as SortDir)
      : defaultDir;

  const supabase = createAdminClient();

  let query = supabase
    .from("spaces_reservations")
    .select("*", { count: "exact" })
    .order(SORT_COLUMN[sortKey], { ascending: sortDir === "asc" })
    .range(offset, offset + PAGE_SIZE - 1);

  if (filter) query = query.eq("status", filter);
  if (search) {
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

  const reservationIds = rows.map((r) => r.id);
  const lineCountByReservation = new Map<string, number>();
  if (reservationIds.length > 0) {
    const { data: lines } = await supabase
      .from("spaces_reservation_lines")
      .select("reservation_id")
      .in("reservation_id", reservationIds);
    for (const line of (lines ?? []) as LineCountRow[]) {
      lineCountByReservation.set(
        line.reservation_id,
        (lineCountByReservation.get(line.reservation_id) ?? 0) + 1
      );
    }
  }

  const statusCounts = await Promise.all(
    STATUS_ORDER.map(async (s) => {
      const { count } = await supabase
        .from("spaces_reservations")
        .select("*", { count: "exact", head: true })
        .eq("status", s);
      return [s, count ?? 0] as const;
    })
  );
  const countsByStatus = new Map(statusCounts);
  const totalAllStatuses = statusCounts.reduce((sum, [, c]) => sum + c, 0);

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [{ count: thisMonthCount }, { count: nextSevenCount }] =
    await Promise.all([
      supabase
        .from("spaces_reservations")
        .select("*", { count: "exact", head: true })
        .gte("event_start_at", firstOfMonth.toISOString())
        .lt("event_start_at", firstOfNextMonth.toISOString()),
      supabase
        .from("spaces_reservations")
        .select("*", { count: "exact", head: true })
        .gte("event_start_at", now.toISOString())
        .lt("event_start_at", sevenDaysOut.toISOString())
        .in("status", ["tentative", "approved", "in_use"]),
    ]);

  const totalPages = Math.max(
    1,
    Math.ceil((totalCount ?? 0) / PAGE_SIZE)
  );

  const calendarWindowStart = new Date(
    now.getFullYear() - 2,
    now.getMonth(),
    1
  );
  const calendarWindowEnd = new Date(
    now.getFullYear() + 2,
    now.getMonth() + 1,
    1
  );
  // Include event_title + each reserved space's name via the
  // spaces_reservation_lines join so the calendar bar can render
  // "<title> - <space names comma-sep> - <organization>". We pull
  // name_snapshot (not spaces.name) so post-facto renames of a space
  // in the catalog don't rewrite the label on past reservations.
  const { data: calendarRowsRaw } = await supabase
    .from("spaces_reservations")
    .select(
      "id, human_id, status, requester_name, organization, event_title, event_start_at, event_end_at, spaces_reservation_lines(name_snapshot)"
    )
    .in("status", CALENDAR_STATUSES)
    .gte("event_end_at", calendarWindowStart.toISOString())
    .lt("event_start_at", calendarWindowEnd.toISOString())
    .order("event_start_at", { ascending: true })
    .limit(1000);
  const calendarReservations: CalendarReservation[] = (calendarRowsRaw ?? []).map(
    (r: {
      id: string;
      human_id: string;
      status: CalendarReservation["status"];
      requester_name: string;
      organization: string | null;
      event_title: string | null;
      event_start_at: string;
      event_end_at: string;
      spaces_reservation_lines?: { name_snapshot: string | null }[] | null;
    }) => ({
      id: r.id,
      human_id: r.human_id,
      status: r.status,
      requester_name: r.requester_name,
      organization: r.organization,
      event_title: r.event_title,
      event_start_at: r.event_start_at,
      event_end_at: r.event_end_at,
      space_names: (r.spaces_reservation_lines ?? [])
        .map((l) => (l.name_snapshot ?? "").trim())
        .filter((n) => n.length > 0),
    })
  );

  return (
    <div>
      <h1
        className="mip-heading text-2xl mip-double-underline inline-block pb-1"
        style={{ color: "var(--color-mip-purple)" }}
      >
        Requests
      </h1>
      <p className="mt-1 text-sm text-mip-gray-600">
        Reservation queue for MIP building spaces.
      </p>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Tentative" value={countsByStatus.get("tentative") ?? 0} />
        <Kpi label="Approved" value={countsByStatus.get("approved") ?? 0} />
        <Kpi label="This month" value={thisMonthCount ?? 0} />
        <Kpi label="Next 7 days" value={nextSevenCount ?? 0} />
      </div>

      <div className="mt-6 flex items-center gap-2 flex-wrap">
        {STATUS_ORDER.map((s) => (
          <FilterTab
            key={s}
            href={buildHref({
              status: s,
              search,
              sort: sortKey,
              dir: sortDir,
            })}
            label={labelForStatus(s)}
            count={countsByStatus.get(s) ?? 0}
            active={filter === s}
          />
        ))}
        <FilterTab
          href={buildHref({
            status: "all",
            search,
            sort: sortKey,
            dir: sortDir,
          })}
          label="All"
          count={totalAllStatuses}
          active={filter === null}
        />
      </div>

      <form
        className="mt-4 flex items-center gap-2"
        action="/admin/spaces"
        method="get"
      >
        {filter && <input type="hidden" name="status" value={filter} />}
        {!filter && <input type="hidden" name="status" value="all" />}
        {sortKey !== "created" && (
          <input type="hidden" name="sort" value={sortKey} />
        )}
        {sortDir !== (sortKey === "created" ? "desc" : "asc") && (
          <input type="hidden" name="dir" value={sortDir} />
        )}
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
            href={buildHref({
              status: filter ?? "all",
              search: "",
              sort: sortKey,
              dir: sortDir,
            })}
            className="text-xs text-mip-gray-500 hover:text-mip-gray-700 underline"
          >
            Clear
          </Link>
        )}
      </form>

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
          <div
            className="mt-6 border border-mip-gray-200"
            style={{ borderRadius: "var(--radius-card)" }}
          >
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-mip-gray-500 bg-mip-gray-50">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Requester</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <SortableHeader
                    label="Start"
                    columnKey="event_start"
                    activeSort={sortKey}
                    activeDir={sortDir}
                    filter={filter}
                    search={search}
                  />
                  <SortableHeader
                    label="End"
                    columnKey="event_end"
                    activeSort={sortKey}
                    activeDir={sortDir}
                    filter={filter}
                    search={search}
                  />
                  <th className="px-3 py-2 font-medium text-right">
                    Contribution
                  </th>
                  <th className="px-3 py-2 font-medium text-center">Spaces</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <SpaceReservationRow
                    key={r.id}
                    reservation={r}
                    lineCount={lineCountByReservation.get(r.id) ?? 0}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-mip-gray-500">
                Page {page} of {totalPages} · {totalCount} total
              </span>
              <div className="flex items-center gap-2">
                <PageLink
                  href={buildHref({
                    status: filter ?? "all",
                    search,
                    sort: sortKey,
                    dir: sortDir,
                    page: page - 1,
                  })}
                  label="Previous"
                  disabled={page <= 1}
                />
                <PageLink
                  href={buildHref({
                    status: filter ?? "all",
                    search,
                    sort: sortKey,
                    dir: sortDir,
                    page: page + 1,
                  })}
                  label="Next"
                  disabled={page >= totalPages}
                />
              </div>
            </div>
          )}
        </>
      )}

      <SpaceReservationsCalendar reservations={calendarReservations} />
    </div>
  );
}

function labelForStatus(s: ReservationRecord["status"]): string {
  switch (s) {
    case "tentative":
      return "Tentative";
    case "approved":
      return "Approved";
    case "in_use":
      return "In use";
    case "completed":
      return "Completed";
    case "denied":
      return "Denied";
    case "cancelled":
      return "Cancelled";
  }
}

interface HrefOpts {
  status: string;
  search: string;
  sort: SortKey;
  dir: SortDir;
  page?: number;
}

function buildHref(opts: HrefOpts): string {
  const { status, search, sort, dir, page } = opts;
  const p = new URLSearchParams();
  if (status && status !== "tentative") p.set("status", status);
  if (search) p.set("q", search);
  if (sort !== "created") p.set("sort", sort);
  const defaultDir: SortDir = sort === "created" ? "desc" : "asc";
  if (dir !== defaultDir) p.set("dir", dir);
  if (page && page > 1) p.set("page", String(page));
  const q = p.toString();
  return q ? `/admin/spaces?${q}` : "/admin/spaces";
}

function SortableHeader({
  label,
  columnKey,
  activeSort,
  activeDir,
  filter,
  search,
}: {
  label: string;
  columnKey: SortKey;
  activeSort: SortKey;
  activeDir: SortDir;
  filter: ReservationRecord["status"] | null;
  search: string;
}) {
  const isActive = activeSort === columnKey;
  const defaultDir: SortDir = columnKey === "created" ? "desc" : "asc";
  const nextDir: SortDir = isActive
    ? activeDir === "asc"
      ? "desc"
      : "asc"
    : defaultDir;
  const href = buildHref({
    status: filter ?? "all",
    search,
    sort: columnKey,
    dir: nextDir,
  });
  return (
    <th className="px-3 py-2 font-medium">
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-mip-gray-800 ${
          isActive ? "text-mip-gray-800" : ""
        }`}
      >
        <span>{label}</span>
        <span className="text-[10px] leading-none" aria-hidden>
          {isActive ? (activeDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
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
      <div
        className="mt-1 text-2xl mip-heading"
        style={{ color: "var(--color-mip-purple)" }}
      >
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

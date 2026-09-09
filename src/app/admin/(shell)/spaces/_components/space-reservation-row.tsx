import Link from "next/link";

interface Reservation {
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
  organization: string | null;
  event_description: string | null;
  event_start_at: string;
  event_end_at: string;
  contribution_total: number | null;
}

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
};

export function SpaceReservationRow({
  reservation,
  lineCount,
}: {
  reservation: Reservation;
  lineCount: number;
}) {
  const start = new Date(reservation.event_start_at);
  const end = new Date(reservation.event_end_at);
  const contribution = reservation.contribution_total ?? 0;

  return (
    <tr className="border-t border-mip-gray-200 hover:bg-mip-gray-50">
      <td className="px-3 py-2 font-mono text-xs">
        <Link
          href={`/admin/spaces/${reservation.human_id}`}
          className="text-mip-purple hover:underline"
        >
          {reservation.human_id}
        </Link>
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{reservation.requester_name}</div>
        <div className="text-xs text-mip-gray-500">
          {reservation.organization ?? "—"} · {reservation.requester_email}
        </div>
      </td>
      <td
        className="px-3 py-2 max-w-xs truncate"
        title={reservation.event_description ?? ""}
      >
        {reservation.event_description ?? (
          <span className="text-mip-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs">
        {start.toLocaleString(undefined, DATE_FMT)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs">
        {end.toLocaleString(undefined, DATE_FMT)}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        ${contribution.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-center text-mip-gray-600">{lineCount}</td>
      <td className="px-3 py-2">
        <StatusBadge status={reservation.status} />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: Reservation["status"] }) {
  const styles: Record<Reservation["status"], string> = {
    tentative: "bg-amber-100 text-amber-800",
    approved: "bg-green-100 text-green-800",
    in_use: "bg-blue-100 text-blue-800",
    completed: "bg-mip-gray-200 text-mip-gray-700",
    denied: "bg-red-100 text-red-800",
    cancelled: "bg-mip-gray-100 text-mip-gray-500",
  };
  const labels: Record<Reservation["status"], string> = {
    tentative: "tentative",
    approved: "approved",
    in_use: "in use",
    completed: "completed",
    denied: "denied",
    cancelled: "cancelled",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${styles[status]}`}
      style={{ borderRadius: "6px" }}
    >
      {labels[status]}
    </span>
  );
}

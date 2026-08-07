import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Stub reservation detail (PR 2).
 *
 * Confirms the [human_id] route resolves and RLS lets us read the row.
 * Full detail view + approve/deny actions ship in PR 3.
 */
export default async function AdminGearReservationPage({
  params,
}: {
  params: Promise<{ human_id: string }>;
}) {
  await requireAdmin();
  const { human_id } = await params;

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("gear_reservations")
    .select("*")
    .eq("human_id", human_id)
    .maybeSingle();

  if (!reservation) notFound();

  const { data: lines } = await supabase
    .from("gear_reservation_lines")
    .select("*")
    .eq("reservation_id", reservation.id);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/gear"
          className="text-xs text-mip-gray-500 hover:text-mip-purple"
        >
          ← Back to queue
        </Link>
        <h1
          className="mt-1 mip-heading text-2xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          {reservation.human_id}
        </h1>
        <p className="mt-1 text-sm text-mip-gray-500">
          Detail view + approve / deny ship in PR 3. This page is a stub so the
          route resolves and RLS is verified end-to-end.
        </p>
      </div>

      <section
        className="border border-mip-gray-200 p-4"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        <h2 className="mip-heading text-sm uppercase tracking-wider text-mip-gray-500">
          Reservation
        </h2>
        <dl className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Field label="Status" value={reservation.status} />
          <Field label="Requester" value={reservation.requester_name} />
          <Field label="Email" value={reservation.requester_email} />
          <Field label="Phone" value={reservation.requester_phone ?? "—"} />
          <Field label="Organization" value={reservation.organization ?? "—"} />
          <Field label="Tier" value={reservation.org_tier ?? "—"} />
          <Field label="Pickup" value={new Date(reservation.pickup_at).toLocaleString()} />
          <Field label="Return" value={new Date(reservation.return_at).toLocaleString()} />
          <Field
            label="Contribution"
            value={`$${(reservation.contribution_total ?? 0).toLocaleString()}`}
          />
          <Field
            label="Subtotal (full)"
            value={`$${(reservation.subtotal_full ?? 0).toLocaleString()}`}
          />
        </dl>
        {reservation.event_description && (
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wider text-mip-gray-500">
              Event
            </div>
            <div className="mt-1 text-sm">{reservation.event_description}</div>
          </div>
        )}
      </section>

      <section
        className="border border-mip-gray-200 p-4"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        <h2 className="mip-heading text-sm uppercase tracking-wider text-mip-gray-500">
          Line items ({lines?.length ?? 0})
        </h2>
        {!lines || lines.length === 0 ? (
          <p className="mt-2 text-sm text-mip-gray-500">No line items.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-mip-gray-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Item</th>
                <th className="py-1 pr-3 font-medium text-center">Qty</th>
                <th className="py-1 pr-3 font-medium text-right">Unit</th>
                <th className="py-1 font-medium text-right">Line</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t border-mip-gray-100">
                  <td className="py-1 pr-3">{line.name_snapshot}</td>
                  <td className="py-1 pr-3 text-center">{line.quantity}</td>
                  <td className="py-1 pr-3 text-right">
                    ${(line.unit_contribution ?? 0).toLocaleString()}
                  </td>
                  <td className="py-1 text-right">
                    ${(line.line_full ?? 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-mip-gray-500">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </>
  );
}

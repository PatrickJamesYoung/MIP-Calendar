import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AdminGearPage() {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const [{ count: itemCount }, { count: reservationCount }, { count: templateCount }] =
    await Promise.all([
      supabase.from("gear_items").select("*", { count: "exact", head: true }),
      supabase.from("gear_reservations").select("*", { count: "exact", head: true }),
      supabase.from("gear_email_templates").select("*", { count: "exact", head: true }),
    ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="mip-heading text-2xl">Gear</h1>
        <p className="text-sm text-mip-gray-500">
          Reservation queue, catalog, settings, and templates for the MIP gear library.
        </p>
      </header>

      <section
        className="border border-mip-gray-200 p-4 space-y-3"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        <h2 className="mip-heading text-sm uppercase tracking-wider text-mip-gray-500">
          Skeleton check
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-mip-gray-500">Signed in as</dt>
          <dd className="font-mono">{admin.email}</dd>

          <dt className="text-mip-gray-500">Role</dt>
          <dd className="font-mono">{admin.role}</dd>

          <dt className="text-mip-gray-500">gear_items</dt>
          <dd className="font-mono">{itemCount ?? "?"}</dd>

          <dt className="text-mip-gray-500">gear_reservations</dt>
          <dd className="font-mono">{reservationCount ?? "?"}</dd>

          <dt className="text-mip-gray-500">gear_email_templates</dt>
          <dd className="font-mono">{templateCount ?? "?"}</dd>
        </dl>
        <p className="text-xs text-mip-gray-500 pt-2">
          If the counts render, the shell + guard + Supabase client all work. Real UI ships in PR 2 (queue).
        </p>
      </section>
    </div>
  );
}

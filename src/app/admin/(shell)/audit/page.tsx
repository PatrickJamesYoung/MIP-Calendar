import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("audit_log")
    .select("id, action, entity_type, entity_id, created_at, admin:admins(email, display_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div>
      <h1
        className="mip-heading text-2xl mip-double-underline inline-block pb-1"
        style={{ color: "var(--color-mip-purple)" }}
      >
        Audit Log
      </h1>
      <p className="mt-3 mb-6 text-sm text-mip-gray-700">
        Last 200 admin actions.
      </p>

      <div className="border border-mip-gray-200" style={{ borderRadius: "var(--radius-button)" }}>
        {(entries ?? []).map((e, i, arr) => {
          const adminField = e.admin;
          const adminRow = Array.isArray(adminField)
            ? adminField[0]
            : (adminField as { email: string; display_name: string | null } | null);
          return (
          <div
            key={e.id}
            className={`flex items-center gap-3 p-3 text-xs ${i < arr.length - 1 ? "border-b border-mip-gray-200" : ""}`}
          >
            <span className="text-mip-gray-500 shrink-0 w-40">
              {new Date(e.created_at).toLocaleString()}
            </span>
            <span className="font-mono text-mip-purple shrink-0 w-24">
              {e.action}
            </span>
            <span className="text-mip-gray-700 shrink-0 w-24">
              {e.entity_type}
            </span>
            <span className="text-mip-gray-500 truncate flex-1">
              {adminRow?.email ?? "unknown"}
            </span>
          </div>
          );
        })}
        {(!entries || entries.length === 0) && (
          <p className="p-4 text-sm text-mip-gray-500 text-center">
            No audit entries yet. Create or edit an event to see activity.
          </p>
        )}
      </div>
    </div>
  );
}

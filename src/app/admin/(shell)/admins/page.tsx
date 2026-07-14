import { requireSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data: admins } = await supabase
    .from("admins")
    .select("id, email, display_name, role, last_active_at, created_at")
    .order("created_at", { ascending: true });

  return (
    <div>
      <h1
        className="mip-heading text-2xl mip-double-underline inline-block pb-1"
        style={{ color: "var(--color-mip-purple)" }}
      >
        Admins
      </h1>
      <p className="mt-3 mb-6 text-sm text-mip-gray-700">
        Only super admins can invite or remove admins.
      </p>

      <div className="border border-mip-gray-200" style={{ borderRadius: "var(--radius-button)" }}>
        {(admins ?? []).map((a, i, arr) => (
          <div
            key={a.id}
            className={`flex items-center gap-3 p-3 ${i < arr.length - 1 ? "border-b border-mip-gray-200" : ""}`}
          >
            <div className="flex-1 min-w-0">
              <div className="mip-heading text-sm truncate">
                {a.display_name ?? a.email}
              </div>
              <div className="text-xs text-mip-gray-500 truncate">
                {a.email} · {a.last_active_at ? `active ${new Date(a.last_active_at).toLocaleDateString()}` : "never active"}
              </div>
            </div>
            <span
              className="px-2 py-0.5 uppercase font-bold tracking-wider text-[10px]"
              style={{
                backgroundColor:
                  a.role === "super" ? "var(--color-mip-purple)" : "var(--color-mip-cyan)",
                color:
                  a.role === "super" ? "var(--color-mip-white)" : "var(--color-mip-purple)",
                borderRadius: "var(--radius-button)",
              }}
            >
              {a.role}
            </span>
          </div>
        ))}
        {(!admins || admins.length === 0) && (
          <p className="p-4 text-sm text-mip-gray-500 text-center">
            No admins yet. Bootstrap the first super admin via SQL.
          </p>
        )}
      </div>

      <p className="mt-6 text-xs text-mip-gray-500">
        Inviting new admins from the UI is coming soon. For now, an existing super admin
        can add a row to <code className="font-mono">admins</code> via Supabase SQL Editor.
      </p>
    </div>
  );
}

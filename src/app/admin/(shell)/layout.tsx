import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminSignOutButton } from "@/components/admin/sign-out-button";

/**
 * Layout for authenticated admin pages: /admin, /admin/events/*, etc.
 * The `(shell)` route group excludes /admin/login and /admin/denied.
 */
export default async function AdminShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="min-h-screen flex flex-col bg-mip-white">
      <header className="border-b border-mip-gray-200 sticky top-0 z-30 bg-mip-white">
        <div
          className="mx-auto flex items-center justify-between px-6 py-3"
          style={{ maxWidth: "var(--max-width-content)" }}
        >
          <div className="flex items-center gap-6">
            <Link
              href="/admin"
              className="mip-heading text-lg"
              style={{ color: "var(--color-mip-purple)" }}
            >
              MIP Admin
            </Link>
            <AdminNav role={admin.role} />
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-mip-gray-500 hidden sm:inline">
              {admin.email}
            </span>
            <span
              className="px-2 py-0.5 uppercase font-bold tracking-wider text-[10px]"
              style={{
                backgroundColor:
                  admin.role === "super"
                    ? "var(--color-mip-purple)"
                    : "var(--color-mip-cyan)",
                color:
                  admin.role === "super"
                    ? "var(--color-mip-white)"
                    : "var(--color-mip-purple)",
                borderRadius: "var(--radius-button)",
              }}
            >
              {admin.role}
            </span>
            <AdminSignOutButton />
          </div>
        </div>
      </header>
      <main
        className="flex-1 mx-auto w-full px-6 py-6"
        style={{ maxWidth: "var(--max-width-content)" }}
      >
        {children}
      </main>
    </div>
  );
}

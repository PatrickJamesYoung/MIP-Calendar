import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { AdminRole } from "./types";

export interface AdminUser {
  id: string;              // admins.id
  user_id: string;         // auth.users.id
  email: string;
  display_name: string | null;
  role: AdminRole;
}

/**
 * Resolves the current session to an admin record.
 * Returns null if not logged in or not in the admins whitelist.
 */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: admin, error } = await supabase
    .from("admins")
    .select("id, user_id, email, display_name, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !admin) return null;

  // Best-effort update of last_active_at. Don't block on errors.
  supabase
    .from("admins")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", admin.id)
    .then(() => {});

  return admin as AdminUser;
}

/**
 * Require an admin session in a server component or server action.
 * Redirects unauthenticated visitors to login and non-admins to /admin/denied.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    // Distinguish "no session" from "logged in but not admin" so the user
    // sees a useful message.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/admin/login");
    redirect("/admin/denied");
  }
  return admin;
}

export async function requireSuperAdmin(): Promise<AdminUser> {
  const admin = await requireAdmin();
  if (admin.role !== "super") redirect("/admin/denied");
  return admin;
}

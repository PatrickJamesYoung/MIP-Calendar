import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for privileged server operations only.
 *
 * ⚠️ Bypasses Row Level Security. Never import this into client components,
 * server components rendered for anonymous users, or anywhere the caller
 * hasn't already been verified as an authenticated admin.
 *
 * Use cases:
 *  - Bootstrapping the first admin
 *  - Bulk imports (Trumba migration, CSV upload)
 *  - Cross-user admin operations that RLS can't express cleanly
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

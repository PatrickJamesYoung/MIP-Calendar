import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for browser/client components.
 * Uses the anon key — all access is enforced by Row Level Security in Postgres.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

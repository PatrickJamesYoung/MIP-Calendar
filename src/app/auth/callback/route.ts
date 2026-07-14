import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback handler.
 *
 * Supabase redirects here with `?code=...` after Google auth succeeds.
 * We exchange the code for a session cookie, then bounce the user to
 * `redirectTo` if it's a safe internal path.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") ?? "/admin";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Only allow same-origin redirects.
      const safe = redirectTo.startsWith("/") ? redirectTo : "/admin";
      return NextResponse.redirect(`${origin}${safe}`);
    }
  }

  // Auth failed — send them back to login with an error flag.
  return NextResponse.redirect(`${origin}/admin/login?error=oauth`);
}

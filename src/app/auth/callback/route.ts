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
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  // On Vercel behind the edge, request.url may reflect the internal origin.
  // Prefer x-forwarded-* headers so the final redirect lands on the same
  // host the user is actually browsing.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : url.origin;
  const code = searchParams.get("code");

  // Prefer the query param, but fall back to the cookie the login form
  // sets right before starting the OAuth flow. Google/Supabase can strip
  // extra query params from the redirect URL in some configurations.
  const cookieRedirect = request.cookies.get("mip_admin_redirect")?.value;
  const decodedCookie = cookieRedirect
    ? safeDecode(cookieRedirect)
    : null;
  const redirectTo =
    searchParams.get("redirectTo") ?? decodedCookie ?? "/admin";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Only allow same-origin redirects.
      const safe = redirectTo.startsWith("/") ? redirectTo : "/admin";
      const res = NextResponse.redirect(`${origin}${safe}`);
      // Best-effort clear the one-shot cookie.
      res.cookies.set("mip_admin_redirect", "", { path: "/", maxAge: 0 });
      return res;
    }
  }

  // Auth failed — send them back to login with an error flag.
  return NextResponse.redirect(`${origin}/admin/login?error=oauth`);
}

function safeDecode(v: string): string | null {
  try {
    return decodeURIComponent(v);
  } catch {
    return null;
  }
}

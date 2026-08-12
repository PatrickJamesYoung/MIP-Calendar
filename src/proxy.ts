import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 renamed middleware.ts to proxy.ts. This file runs on every
 * matched request and does two jobs:
 *
 *   1. Redirect the old canonical host (calendar.*) to the new one (app.*),
 *      preserving path and query. This must happen BEFORE the Supabase
 *      session refresh so we don't set cookies on the wrong host.
 *
 *   2. Refresh the Supabase session cookie and guard /admin/* routes.
 *      See lib/supabase/middleware.ts for details.
 */

const OLD_HOST = "calendar.movementinfrastructureproject.org";
const NEW_HOST = "app.movementinfrastructureproject.org";

export async function proxy(request: NextRequest) {
  // Prefer x-forwarded-host (Vercel edge) over the raw host header.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const rawHost = request.headers.get("host");
  const host = (forwardedHost ?? rawHost ?? "").toLowerCase();

  if (host === OLD_HOST) {
    const url = new URL(request.url);
    url.host = NEW_HOST;
    url.protocol = "https:";
    // 308 keeps the request method and is permanent — Google will remember
    // the new URL and old bookmarks/embeds will not need to be updated.
    return NextResponse.redirect(url, 308);
  }

  // Skip the Supabase session-cookie refresh for API routes.
  //
  // API routes handle their own auth (bearer tokens for /api/ingest/*,
  // Turnstile for public POSTs, service-role clients elsewhere) and never
  // read the SSR session cookie. Running updateSession() on every ingest
  // webhook, view-count beacon, and ICS download would be pure overhead
  // and can leak cookie work into responses meant for machines.
  //
  // NOTE: we still keep API paths in the matcher below so the host
  // redirect above catches any lingering `calendar.*` API traffic.
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/")) {
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip Next internals and static assets, but keep API routes in scope
    // so the host redirect above still applies.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};

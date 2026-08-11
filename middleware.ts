import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirect the old calendar.* hostname to the new canonical app.* host.
 *
 * We migrated from calendar.movementinfrastructureproject.org to
 * app.movementinfrastructureproject.org when the app grew beyond a
 * calendar (gear library, admin portal, etc). Existing bookmarks,
 * embed URLs, and outbound links should keep working forever, so we
 * 308 (permanent + method-preserving) redirect to the new host with
 * the path and query preserved.
 */
const OLD_HOST = "calendar.movementinfrastructureproject.org";
const NEW_HOST = "app.movementinfrastructureproject.org";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (host === OLD_HOST) {
    const url = new URL(request.url);
    url.host = NEW_HOST;
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

// Match everything except Next.js internals and static assets.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|json|css|js|map|woff2?)$).*)",
  ],
};

// Deliberately allow only non-personal, public landing pages. Unknown routes
// fail closed, including request confirmations and OAuth/admin/invoice paths.
const publicPaths = new Set([
  "/", "/calendar", "/gear", "/spaces", "/reservations/privacy", "/reservations/terms",
]);
export function safeAnalyticsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (!publicPaths.has(path)) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

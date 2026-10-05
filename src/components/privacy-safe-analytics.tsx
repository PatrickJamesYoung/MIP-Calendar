"use client";

import { Analytics } from "@vercel/analytics/next";
import { safeAnalyticsUrl } from "@/lib/analytics-privacy";

export function PrivacySafeAnalytics() {
  return <Analytics beforeSend={event => {
    // Check both the event and current location to cover SPA navigations after
    // the script was first loaded on a public page. Never forward custom data.
    if (event.type !== "pageview" || !safeAnalyticsUrl(window.location.href)) return null;
    const url = safeAnalyticsUrl(event.url);
    return url ? { ...event, url } : null;
  }} />;
}

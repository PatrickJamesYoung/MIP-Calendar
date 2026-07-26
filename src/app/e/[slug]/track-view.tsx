"use client";

import { useEffect } from "react";

/**
 * Fires a one-shot POST to /api/events/[slug]/view when the detail
 * page mounts. Anonymous — no cookie, no ID, no PII. Uses
 * navigator.sendBeacon when available so it survives nav-away, and
 * falls back to fetch(keepalive) otherwise.
 *
 * StrictMode double-invokes effects in dev, so we guard with a
 * per-slug session flag to avoid two hits per real view during
 * development. In production this still allows every fresh mount to
 * count (refresh, navigate away and back, etc.) — that matches the
 * "detail-page views only, anonymous counts only" spec.
 */
export function TrackView({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug) return;
    // Guard against React StrictMode double-invocation only (per
    // tab-session per slug). Not a real dedup — we intentionally want
    // to count refreshes across page loads.
    const key = `__mip_viewed_${slug}`;
    if (typeof window !== "undefined") {
      // Use a window-attached flag to survive StrictMode re-run
      // without persisting across real reloads.
      const w = window as unknown as Record<string, unknown>;
      if (w[key]) return;
      w[key] = true;
    }

    const url = `/api/events/${encodeURIComponent(slug)}/view`;
    const payload = new Blob(["{}"], { type: "application/json" });

    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(url, payload)
      ) {
        return;
      }
    } catch {
      // fall through to fetch
    }

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
    }).catch(() => {
      // Swallow — analytics are best-effort.
    });
  }, [slug]);

  return null;
}

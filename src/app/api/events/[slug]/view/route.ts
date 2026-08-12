/**
 * POST /api/events/[slug]/view
 *
 * Anonymous view-count increment for the public event detail page.
 * Called from a client-side beacon on mount (see track-view.tsx).
 * Counts one hit per page mount — no session dedup, no IP/UA storage,
 * no PII. Only counts published events (the RPC filters by status).
 *
 * Returns { view_count } so the client could show it live if we ever
 * want to; for now the response is just a 200.
 */

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cheap in-process limiter. 120 hits per minute per IP is well above any
// legitimate page-view beacon rate and cuts off trivially scripted floods.
const VIEW_RATE_LIMIT = {
  name: "event-view",
  max: 120,
  windowMs: 60 * 1000,
} as const;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;
  if (!slug) return Response.json({ error: "missing slug" }, { status: 400 });

  const ip = clientIpFromHeaders(req.headers);
  const rl = checkRateLimit(ip, VIEW_RATE_LIMIT);
  if (!rl.ok) {
    return Response.json(
      { error: "rate_limited", retry_in_sec: rl.retryInSec },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryInSec) },
      }
    );
  }

  const supabase = await createClient();

  const { data: ev, error: lookupErr } = await supabase
    .from("events")
    .select("id, status")
    .eq("slug", slug)
    .maybeSingle();

  if (lookupErr || !ev) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (ev.status !== "published") {
    // Silently accept so drafts don't leak status via error codes.
    return Response.json({ ok: true, view_count: null });
  }

  const { data: newCount, error: rpcErr } = await supabase.rpc(
    "record_event_view",
    { p_event_id: ev.id }
  );
  if (rpcErr) {
    return Response.json(
      { error: "increment_failed", detail: rpcErr.message },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, view_count: newCount });
}

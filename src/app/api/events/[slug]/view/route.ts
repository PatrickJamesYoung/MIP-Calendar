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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;
  if (!slug) return Response.json({ error: "missing slug" }, { status: 400 });

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

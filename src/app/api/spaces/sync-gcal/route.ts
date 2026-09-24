/**
 * GET /api/spaces/sync-gcal
 *
 * Daily cron that pulls events from the configured Google Calendar
 * and creates matching approved reservations. Structural mirror of
 * /api/spaces/poll-replies.
 *
 * Bearer-authorized via CRON_SECRET. Idempotent (uses a persisted
 * syncToken plus a unique index on gcal_event_id), so a caller that
 * accidentally hammers the endpoint won't create duplicates.
 */

import { NextResponse } from "next/server";
import { pullGcalEvents, type PullResult } from "@/lib/gcal/sync";
import { sendAdminEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email/resend-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s is the Vercel Pro Node runtime cap. The daily sync's cost is
// dominated by the DB writes when a bootstrap or a large delta lands;
// with the bulk-insert rewrite (see src/lib/gcal/sync.ts) it should
// finish in a few seconds even on a full re-bootstrap of a few hundred
// events, but 300s gives headroom for a bad day.
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    await alertFailure("cron-secret-not-configured", 500);
    return NextResponse.json(
      { ok: false, error: "cron-secret-not-configured" },
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const started = Date.now();
  let result: PullResult;
  try {
    result = await pullGcalEvents();
  } catch (e) {
    result = { ok: false, error: `threw: ${(e as Error).message}` };
  }
  const elapsed_ms = Date.now() - started;

  const status = result.ok ? 200 : 500;
  // Email admins on failure only. Successful runs (including no-op
  // days) stay silent.
  if (!result.ok) {
    await alertFailure(result.error ?? "unknown-error", status, elapsed_ms);
  }
  return NextResponse.json({ ...result, elapsed_ms }, { status });
}

const ADMIN_URL = "https://app.movementinfrastructureproject.org/admin/spaces";

/**
 * Failure email to ADMIN_NOTIFY_EMAILS. Never throws; an email problem
 * must not mask the sync failure in the HTTP response or Vercel logs.
 */
async function alertFailure(error: string, status: number, elapsedMs?: number) {
  try {
    const when = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short",
    });
    const elapsed = elapsedMs != null ? ` after ${Math.round(elapsedMs / 1000)}s` : "";
    const res = await sendAdminEmail({
      subject: "[MIP Calendar] Google Calendar sync failed",
      bodyHtml: `
        <p>The daily Google Calendar sync failed at ${escapeHtml(when)} ET${escapeHtml(elapsed)} (HTTP ${status}).</p>
        <p style="background:#f9fafb;border-left:3px solid #39375b;padding:12px 16px;margin:16px 0;color:#111827;"><code>${escapeHtml(error)}</code></p>
        <p>The next run is tomorrow at 7:00 UTC. The sync is safe to re-run, so it will catch up once the cause is fixed.</p>
        <p><a href="${ADMIN_URL}">Open Spaces admin</a></p>`,
      bodyText: `The daily Google Calendar sync failed at ${when} ET${elapsed} (HTTP ${status}).\n\nError: ${error}\n\nNext run: tomorrow 7:00 UTC.\n${ADMIN_URL}`,
    });
    if (!res.ok) console.error("[sync-gcal] failure alert not sent:", res.error);
  } catch (e) {
    console.error("[sync-gcal] failure alert threw:", e);
  }
}

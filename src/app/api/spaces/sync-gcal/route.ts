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
import { pullGcalEvents } from "@/lib/gcal/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
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
  const result = await pullGcalEvents();
  const elapsed_ms = Date.now() - started;

  const status = result.ok ? 200 : 500;
  return NextResponse.json({ ...result, elapsed_ms }, { status });
}

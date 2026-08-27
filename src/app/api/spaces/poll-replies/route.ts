/**
 * GET /api/spaces/poll-replies
 *
 * Structural mirror of /api/gear/poll-replies. Vercel cron hits this
 * on the same cadence; it polls Gmail for recent inbound messages that
 * match outbound threads in `spaces_email_messages` and inserts them
 * back into that table.
 */

import { NextResponse } from "next/server";
import { pollSpacesGmailReplies } from "@/lib/spaces/poll-replies";

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
  const result = await pollSpacesGmailReplies();
  const elapsed_ms = Date.now() - started;

  const status = result.ok ? 200 : 500;
  return NextResponse.json({ ...result, elapsed_ms }, { status });
}

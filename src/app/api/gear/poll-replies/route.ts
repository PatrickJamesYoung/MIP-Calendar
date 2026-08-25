/**
 * GET /api/gear/poll-replies
 *
 * Vercel cron hits this every 15 minutes. It queries Gmail for any
 * recent messages that landed in the info@ inbox, matches them to
 * outbound gear-library threads, and inserts inbound rows into
 * `gear_email_messages`. The Emails panel on the reservation detail
 * page picks them up automatically.
 *
 * Auth: Vercel injects `Authorization: Bearer $CRON_SECRET` on cron
 * requests. We reject anything without a matching token so this
 * endpoint isn't a public reply-scraper.
 *
 * Response is a small JSON summary of the run — matches Vercel's
 * logs UI, and gives us a manual retry story if we ever need to
 * kick off a poll by hand.
 */

import { NextResponse } from "next/server";
import { pollGmailReplies } from "@/lib/gear/poll-replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Gmail list + N gets can take a few seconds; give the route headroom.
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
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const result = await pollGmailReplies();
  const elapsed_ms = Date.now() - started;

  const status = result.ok ? 200 : 500;
  return NextResponse.json({ ...result, elapsed_ms }, { status });
}

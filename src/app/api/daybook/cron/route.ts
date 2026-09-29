/**
 * GET /api/daybook/cron
 *
 * Vercel Cron entry point for the DC Daybook. GitHub Actions' own
 * scheduler was starting the 06:15 ET run 5-8 hours late, so the clock
 * now lives here and this route just dispatches the existing
 * `daybook.yml` workflow (the Python fetch step still runs on Actions).
 *
 * DST: Vercel Cron is UTC-only. vercel.json fires twice per slot (EDT
 * and EST UTC times); this route checks the America/New_York wall clock
 * and dispatches only from the invocation that lands on the intended
 * local hour. Each slot therefore dispatches exactly once year-round.
 *
 *   weekdays 06:15 ET -> edition=daybook
 *   Sundays  07:00 ET -> edition=weekly
 *
 * Sends stay governed by the repo variable DAYBOOK_LIVE_SEND inside the
 * workflow (trigger=cron). This route never decides to go live.
 *
 * Bearer-authorized via CRON_SECRET. Failures email ADMIN_NOTIFY_EMAILS.
 */

import { NextResponse } from "next/server";
import { sendAdminEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email/resend-client";
import { slotFor, type Slot } from "@/lib/daybook/slot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = "PatrickJamesYoung/MIP-Calendar";
const WORKFLOW = "daybook.yml";
const ACTIONS_URL = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    await alertFailure("cron-secret-not-configured");
    return NextResponse.json({ ok: false, error: "cron-secret-not-configured" }, { status: 500 });
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // ?test=1 dispatches a forced dry run for the current ET date so the
  // token and dispatch path can be verified outside publication hours.
  // Always dry: trigger=manual + dry_run=true, so it can never send.
  const isTest = new URL(req.url).searchParams.get("test") === "1";
  const now = new Date();
  const slot: Slot | null = isTest
    ? {
        edition: "daybook",
        publication_date: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now),
      }
    : slotFor(now);
  if (!slot) {
    // The other half of a DST pair. Expected, silent.
    return NextResponse.json({ ok: true, skipped: "not_publication_hour_et" });
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    await alertFailure("missing GITHUB_DISPATCH_TOKEN", slot);
    return NextResponse.json({ ok: false, error: "missing_GITHUB_DISPATCH_TOKEN" }, { status: 500 });
  }

  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            edition: slot.edition,
            publication_date: slot.publication_date,
            ...(isTest ? { trigger: "manual", dry_run: "true" } : { trigger: "cron" }),
          },
        }),
      }
    );
    if (r.status !== 204) {
      const detail = `github_dispatch_${r.status}:${(await r.text()).slice(0, 300)}`;
      await alertFailure(detail, slot);
      return NextResponse.json({ ok: false, error: detail }, { status: 502 });
    }
  } catch (e) {
    const detail = `github_dispatch_threw:${(e as Error).message}`;
    await alertFailure(detail, slot);
    return NextResponse.json({ ok: false, error: detail }, { status: 502 });
  }

  return NextResponse.json({ ok: true, dispatched: slot, test: isTest });
}

async function alertFailure(error: string, slot?: Slot) {
  try {
    const what = slot ? `${slot.edition} for ${slot.publication_date}` : "the scheduled run";
    const res = await sendAdminEmail({
      subject: "[MIP Calendar] DC Daybook cron could not start the workflow",
      bodyHtml: `
        <p>The Vercel cron could not start ${escapeHtml(what)}.</p>
        <p style="background:#f9fafb;border-left:3px solid #39375b;padding:12px 16px;margin:16px 0;color:#111827;"><code>${escapeHtml(error)}</code></p>
        <p>You can start it by hand from GitHub Actions (Run workflow).</p>
        <p><a href="${ACTIONS_URL}">Open the Daybook workflow</a></p>`,
      bodyText: `The Vercel cron could not start ${what}.\n\nError: ${error}\n\nStart it by hand: ${ACTIONS_URL}`,
    });
    if (!res.ok) console.error("[daybook-cron] alert not sent:", res.error);
  } catch (e) {
    console.error("[daybook-cron] alert threw:", e);
  }
}

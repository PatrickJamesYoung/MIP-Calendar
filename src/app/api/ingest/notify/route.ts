/**
 * POST /api/ingest/notify
 *
 * Called by the GitHub Actions ingest workflow to email a run summary
 * to the admins. Uses the same bearer-token auth as the other
 * /api/ingest/* endpoints, and reuses the Vercel-side Resend key + email
 * wrapper — so no Resend secrets need to live on GitHub.
 *
 * Body:
 *   {
 *     subject_suffix: string,   // "35 new · 12 submitted"
 *     status: string,           // job.status from workflow ("success" | "failure" | ...)
 *     run_id?: string,
 *     run_url?: string,
 *     total_new?: number,
 *     inserted?: number,
 *     needs_review?: number,
 *     skipped?: number,
 *     by_source?: Record<string, number>,
 *     dry_run?: boolean
 *   }
 */

import { checkIngestAuth } from "@/lib/ingest/auth";
import { sendAdminEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface NotifyBody {
  subject_suffix?: string;
  status?: string;
  run_id?: string;
  run_url?: string;
  total_new?: number;
  inserted?: number;
  needs_review?: number;
  skipped?: number;
  by_source?: Record<string, number>;
  dry_run?: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(req: Request) {
  const auth = checkIngestAuth(req);
  if (!auth.ok) return auth.response;

  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const status = (body.status ?? "completed").toUpperCase();
  const dryTag = body.dry_run ? " [DRY RUN]" : "";
  const subject = `[MIP ingest ${status}]${dryTag} ${body.subject_suffix ?? ""}`.trim();

  const bySourceEntries = Object.entries(body.by_source ?? {}).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  const htmlParts: string[] = [];
  htmlParts.push(
    `<p><strong>${body.total_new ?? 0}</strong> new events after dedup.</p>`
  );

  if (bySourceEntries.length > 0) {
    htmlParts.push("<p><strong>By source:</strong></p><ul>");
    for (const [src, n] of bySourceEntries) {
      htmlParts.push(`<li>${escapeHtml(src)}: ${n}</li>`);
    }
    htmlParts.push("</ul>");
  }

  const summaryBits: string[] = [];
  if (typeof body.inserted === "number")
    summaryBits.push(`<strong>Submitted:</strong> ${body.inserted}`);
  if (body.needs_review) summaryBits.push(`needs review: ${body.needs_review}`);
  if (body.skipped) summaryBits.push(`skipped as dup: ${body.skipped}`);
  if (summaryBits.length > 0) {
    htmlParts.push(`<p>${summaryBits.join(" &middot; ")}</p>`);
  }

  if (body.run_url) {
    htmlParts.push(
      `<p><a href="${escapeHtml(body.run_url)}" style="color:#39375b;font-weight:600;">View full run log &rarr;</a>` +
        (body.run_id ? ` &middot; run <code>${escapeHtml(body.run_id)}</code>` : "") +
        `</p>`
    );
  }

  // Plain-text fallback.
  const textLines: string[] = [];
  textLines.push(`MIP calendar ingest — ${status}`);
  textLines.push("");
  textLines.push(`${body.total_new ?? 0} new events after dedup.`);
  if (bySourceEntries.length > 0) {
    textLines.push("");
    textLines.push("By source:");
    for (const [src, n] of bySourceEntries) textLines.push(`  ${src}: ${n}`);
  }
  if (summaryBits.length > 0) {
    textLines.push("");
    textLines.push(
      `Submitted: ${body.inserted ?? 0}` +
        (body.needs_review ? ` · needs review: ${body.needs_review}` : "") +
        (body.skipped ? ` · skipped as dup: ${body.skipped}` : "")
    );
  }
  if (body.run_url) {
    textLines.push("");
    textLines.push(`Run log: ${body.run_url}`);
  }

  const result = await sendAdminEmail({
    subject,
    bodyHtml: htmlParts.join(""),
    bodyText: textLines.join("\n"),
    preheader: `${body.total_new ?? 0} new events after dedup`,
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error ?? "email-failed" },
      { status: 200 } // 200 so the workflow doesn't fail on email issues
    );
  }
  return Response.json({ ok: true });
}

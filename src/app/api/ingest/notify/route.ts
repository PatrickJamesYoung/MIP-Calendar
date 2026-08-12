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

import { withIngestAuth } from "@/lib/ingest/handler";
import { sendAdminEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email/resend-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CrossSourceEntry {
  match_type?: "exact" | "fuzzy" | string;
  ratio?: number;
  kept?: { source?: string; title?: string; date?: string };
  dropped?: { source?: string; title?: string; date?: string };
}

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
  cross_source_collapsed?: number;
  cross_source_entries?: CrossSourceEntry[];
  dry_run?: boolean;
}



export const POST = withIngestAuth<NotifyBody>(async ({ body: rawBody }) => {
  // notify accepts empty body (as a bare completion ping) but the caller
  // always sends a payload today. Treat missing as empty.
  const body: NotifyBody = rawBody ?? {};
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

  // Cross-source dedup audit — only shown when the collapse step actually
  // dropped something. Grassroots DC aggregates from Free DC / Rhizome /
  // Mobilize etc., so this section is where we surface those overlaps.
  const collapsed = body.cross_source_collapsed ?? 0;
  const entries = body.cross_source_entries ?? [];
  if (collapsed > 0) {
    htmlParts.push(
      `<p><strong>Cross-source dedup:</strong> collapsed ${collapsed} duplicate ${
        collapsed === 1 ? "event" : "events"
      } across sources.</p>`
    );
    if (entries.length > 0) {
      htmlParts.push(
        '<table style="border-collapse:collapse;font-size:13px;margin:0 0 12px 0;">'
      );
      htmlParts.push(
        '<tr><th align="left" style="padding:4px 8px;border-bottom:1px solid #d4d1ca;">Kept</th>' +
          '<th align="left" style="padding:4px 8px;border-bottom:1px solid #d4d1ca;">Dropped</th>' +
          '<th align="left" style="padding:4px 8px;border-bottom:1px solid #d4d1ca;">Match</th>' +
          '<th align="left" style="padding:4px 8px;border-bottom:1px solid #d4d1ca;">Event</th></tr>'
      );
      for (const e of entries) {
        const keptSrc = e.kept?.source ?? "?";
        const droppedSrc = e.dropped?.source ?? "?";
        const title = e.dropped?.title ?? e.kept?.title ?? "";
        const date = e.kept?.date ?? e.dropped?.date ?? "";
        const mt = e.match_type ?? "";
        const ratio = e.match_type === "fuzzy" && typeof e.ratio === "number"
          ? ` <span style="color:#7a7974;">(${e.ratio.toFixed(2)})</span>`
          : "";
        htmlParts.push(
          `<tr><td style="padding:4px 8px;">${escapeHtml(keptSrc)}</td>` +
            `<td style="padding:4px 8px;color:#7a7974;">${escapeHtml(droppedSrc)}</td>` +
            `<td style="padding:4px 8px;">${escapeHtml(mt)}${ratio}</td>` +
            `<td style="padding:4px 8px;">${escapeHtml(title)}${date ? ` &middot; ${escapeHtml(date)}` : ""}</td></tr>`
        );
      }
      htmlParts.push("</table>");
      if (collapsed > entries.length) {
        htmlParts.push(
          `<p style="color:#7a7974;font-size:13px;">(showing ${entries.length} of ${collapsed} \u2014 see run artifact for full list)</p>`
        );
      }
    }
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
  if (collapsed > 0) {
    textLines.push("");
    textLines.push(
      `Cross-source dedup: collapsed ${collapsed} duplicate ${collapsed === 1 ? "event" : "events"}.`
    );
    for (const e of entries) {
      const keptSrc = e.kept?.source ?? "?";
      const droppedSrc = e.dropped?.source ?? "?";
      const title = e.dropped?.title ?? e.kept?.title ?? "";
      const mt = e.match_type ?? "";
      const ratio = e.match_type === "fuzzy" && typeof e.ratio === "number"
        ? ` (${e.ratio.toFixed(2)})`
        : "";
      textLines.push(`  kept ${keptSrc} · dropped ${droppedSrc} · ${mt}${ratio} · ${title}`);
    }
    if (collapsed > entries.length) {
      textLines.push(`  (showing ${entries.length} of ${collapsed})`);
    }
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
});

/**
 * Notify organizers when a new gear reservation request arrives.
 *
 * Recipients come from the `organizer_emails` setting (jsonb array of
 * addresses, edited in /admin/gear/settings). If unset, we fall back to
 * ADMIN_NOTIFY_EMAILS so we don't drop notifications on the floor.
 */

import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.GEAR_EMAIL_FROM ?? "";
const REPLY_TO = process.env.GEAR_REPLY_TO ?? "";
const FALLBACK_ADMIN = (process.env.ADMIN_NOTIFY_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "";

const client = apiKey ? new Resend(apiKey) : null;

interface ReservationLike {
  id: string;
  human_id: string;
  requester_name: string;
  requester_email: string;
  event_description: string | null;
  pickup_at: string;
  return_at: string;
  contribution_total: number | null;
  subtotal_full: number | null;
  organization: string | null;
}

interface LineLike {
  name_snapshot: string;
  quantity: number;
  unit_contribution: number | null;
  line_full: number | null;
}

export async function notifyOrganizersOfNewGearRequest(args: {
  reservation: ReservationLike;
  lines: LineLike[];
  orgTier: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!client) {
    console.warn("[gear-notify] RESEND_API_KEY not set — skipping notify");
    return { ok: false, error: "email-not-configured" };
  }
  if (!FROM) {
    console.warn("[gear-notify] GEAR_EMAIL_FROM not set — skipping notify");
    return { ok: false, error: "gear-email-from-not-set" };
  }

  const supabase = createAdminClient();
  const { data: settingRow } = await supabase
    .from("gear_settings")
    .select("value")
    .eq("key", "organizer_emails")
    .maybeSingle();

  const configured = Array.isArray(settingRow?.value)
    ? (settingRow!.value as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.includes("@")
      )
    : [];
  const recipients = configured.length > 0 ? configured : FALLBACK_ADMIN;
  if (recipients.length === 0) {
    console.warn(
      "[gear-notify] no organizer_emails and no ADMIN_NOTIFY_EMAILS — dropping notify"
    );
    return { ok: false, error: "no-recipients" };
  }

  const r = args.reservation;
  const reviewUrl = SITE_URL
    ? `${SITE_URL.replace(/\/$/, "")}/admin/gear/${encodeURIComponent(
        r.human_id
      )}`
    : `/admin/gear/${encodeURIComponent(r.human_id)}`;
  const subject = `New gear request: ${r.human_id} — ${r.requester_name}`;

  const pickup = new Date(r.pickup_at);
  const rtn = new Date(r.return_at);
  const dateFmt = (d: Date) =>
    d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short",
    });

  const linesText = args.lines
    .map((l) => `- ${l.quantity}× ${l.name_snapshot}`)
    .join("\n");
  const text =
    `New gear reservation request\n\n` +
    `ID: ${r.human_id}\n` +
    `From: ${r.requester_name} <${r.requester_email}>\n` +
    (r.organization ? `Org: ${r.organization} (tier: ${args.orgTier})\n` : `Tier: ${args.orgTier}\n`) +
    `Pickup: ${dateFmt(pickup)} ET\n` +
    `Return: ${dateFmt(rtn)} ET\n` +
    `Suggested contribution: $${Number(r.contribution_total ?? 0).toFixed(2)}\n\n` +
    `Items:\n${linesText}\n\n` +
    (r.event_description ? `Event: ${r.event_description}\n\n` : "") +
    `Review: ${reviewUrl}`;

  const linesHtml = args.lines
    .map(
      (l) =>
        `<li>${escapeHtml(String(l.quantity))}× ${escapeHtml(l.name_snapshot)}</li>`
    )
    .join("");
  const html = wrapEmail(
    "New gear reservation request",
    `
    <p><strong>${escapeHtml(r.requester_name)}</strong>
      &lt;${escapeHtml(r.requester_email)}&gt; submitted a request.</p>
    ${r.organization ? `<p><strong>Org:</strong> ${escapeHtml(r.organization)} (tier: ${escapeHtml(args.orgTier)})</p>` : `<p><strong>Tier:</strong> ${escapeHtml(args.orgTier)}</p>`}
    <p>
      <strong>Pickup:</strong> ${escapeHtml(dateFmt(pickup))} ET<br />
      <strong>Return:</strong> ${escapeHtml(dateFmt(rtn))} ET<br />
      <strong>Suggested contribution:</strong> $${Number(
        r.contribution_total ?? 0
      ).toFixed(2)}
    </p>
    <p><strong>Items:</strong></p>
    <ul>${linesHtml}</ul>
    ${r.event_description ? `<p><strong>Event:</strong> ${escapeHtml(r.event_description)}</p>` : ""}
    <p style="margin-top:20px;">
      <a href="${reviewUrl}" style="background:#39375b;color:#fff;padding:10px 18px;border-radius:7px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;">Review request</a>
    </p>
    `
  );

  try {
    const { error } = await client.emails.send({
      from: FROM,
      to: recipients,
      replyTo: REPLY_TO || undefined,
      subject,
      html,
      text,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapEmail(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7f7;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;">
    <h1 style="color:#39375b;font-size:20px;margin:0 0 16px;">${escapeHtml(title)}</h1>
    <div style="color:#333;line-height:1.5;font-size:14px;">${bodyHtml}</div>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <p style="color:#999;font-size:12px;">MIP Gear Library</p>
  </div>
</body></html>`;
}

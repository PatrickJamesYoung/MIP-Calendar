/**
 * Notify organizers when a new space reservation request arrives.
 *
 * Recipients come from the `organizer_emails` setting (jsonb array of
 * addresses, edited in /admin/spaces/settings). If unset, we fall back to
 * ADMIN_NOTIFY_EMAILS so we don't drop notifications on the floor.
 */

import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.SPACE_EMAIL_FROM ?? process.env.GEAR_EMAIL_FROM ?? "";
const REPLY_TO = process.env.SPACE_REPLY_TO ?? process.env.GEAR_REPLY_TO ?? "";
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
  event_title: string;
  event_description: string | null;
  load_in_at: string;
  event_start_at: string;
  event_end_at: string;
  load_out_at: string;
  contribution_total: number | null;
  organization: string | null;
}

interface LineLike {
  name_snapshot: string;
}

export async function notifyOrganizersOfNewSpaceRequest(args: {
  reservation: ReservationLike;
  lines: LineLike[];
  orgTier: string;
  equipment?: string[] | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!client) {
    console.warn("[spaces-notify] RESEND_API_KEY not set — skipping notify");
    return { ok: false, error: "email-not-configured" };
  }
  if (!FROM) {
    console.warn("[spaces-notify] SPACE_EMAIL_FROM/GEAR_EMAIL_FROM not set — skipping notify");
    return { ok: false, error: "space-email-from-not-set" };
  }

  const supabase = createAdminClient();
  const { data: settingRow } = await supabase
    .from("spaces_settings")
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
      "[spaces-notify] no organizer_emails and no ADMIN_NOTIFY_EMAILS — dropping notify"
    );
    return { ok: false, error: "no-recipients" };
  }

  const r = args.reservation;
  const reviewUrl = SITE_URL
    ? `${SITE_URL.replace(/\/$/, "")}/admin/spaces/${encodeURIComponent(
        r.human_id
      )}`
    : `/admin/spaces/${encodeURIComponent(r.human_id)}`;
  const subject = `New space request: ${r.human_id} — ${r.event_title || r.requester_name}`;

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short",
    });
  const spaces = args.lines.map((l) => l.name_snapshot);
  const equipment = args.equipment ?? [];
  const tierLine = r.organization
    ? `Org: ${r.organization} (tier: ${args.orgTier})`
    : `Tier: ${args.orgTier}`;

  const text =
    `New space reservation request\n\n` +
    `ID: ${r.human_id}\n` +
    `Event: ${r.event_title}\n` +
    `From: ${r.requester_name} <${r.requester_email}>\n` +
    `${tierLine}\n` +
    `Load-in: ${dateFmt(r.load_in_at)} ET\n` +
    `Event: ${dateFmt(r.event_start_at)} – ${dateFmt(r.event_end_at)} ET\n` +
    `Load-out: ${dateFmt(r.load_out_at)} ET\n` +
    `Suggested contribution: $${Number(r.contribution_total ?? 0).toFixed(2)}\n\n` +
    `Spaces:\n${spaces.map((n) => `- ${n}`).join("\n")}\n\n` +
    (equipment.length ? `Equipment:\n${equipment.map((n) => `- ${n}`).join("\n")}\n\n` : "") +
    (r.event_description ? `Description: ${r.event_description}\n\n` : "") +
    `Review: ${reviewUrl}`;

  const list = (items: string[]) =>
    `<ul>${items.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`;
  const html = wrapEmail(
    "New space reservation request",
    `
    <p><strong>${escapeHtml(r.event_title)}</strong></p>
    <p><strong>${escapeHtml(r.requester_name)}</strong>
      &lt;${escapeHtml(r.requester_email)}&gt; submitted a request.</p>
    <p>${r.organization ? `<strong>Org:</strong> ${escapeHtml(r.organization)} (tier: ${escapeHtml(args.orgTier)})` : `<strong>Tier:</strong> ${escapeHtml(args.orgTier)}`}</p>
    <p>
      <strong>Load-in:</strong> ${escapeHtml(dateFmt(r.load_in_at))} ET<br />
      <strong>Event:</strong> ${escapeHtml(dateFmt(r.event_start_at))} – ${escapeHtml(dateFmt(r.event_end_at))} ET<br />
      <strong>Load-out:</strong> ${escapeHtml(dateFmt(r.load_out_at))} ET<br />
      <strong>Suggested contribution:</strong> $${Number(r.contribution_total ?? 0).toFixed(2)}
    </p>
    <p><strong>Spaces:</strong></p>
    ${list(spaces)}
    ${equipment.length ? `<p><strong>Equipment:</strong></p>${list(equipment)}` : ""}
    ${r.event_description ? `<p><strong>Description:</strong> ${escapeHtml(r.event_description)}</p>` : ""}
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
    <p style="color:#999;font-size:12px;">MIP Spaces</p>
  </div>
</body></html>`;
}

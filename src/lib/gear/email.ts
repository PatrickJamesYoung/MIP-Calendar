/**
 * Gear-library transactional email.
 *
 * Emails are rendered from templates stored in `gear_email_templates`
 * (edited by organizers in the admin UI in PR 4). Settings like
 * `organization_name`, `donation_url`, and `tentative_disclaimer` come
 * from `gear_settings`.
 *
 * Config (env):
 *   RESEND_API_KEY  — shared with the calendar's email helper
 *   GEAR_EMAIL_FROM — e.g. "MIP Gear Library <gear@send.movementinfrastructureproject.org>"
 *   GEAR_REPLY_TO   — e.g. "info@movementinfrastructureproject.org"
 *
 * If RESEND_API_KEY or GEAR_EMAIL_FROM is missing, sends no-op with a
 * warning so admin actions don't crash in dev / preview environments.
 */

import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

export type GearEmailTemplateKey =
  | "submission_ack"
  | "approve"
  | "deny"
  | "followup";

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.GEAR_EMAIL_FROM ?? "";
const REPLY_TO = process.env.GEAR_REPLY_TO ?? "";

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

interface SendResult {
  ok: boolean;
  error?: string;
  subject?: string;
}

export interface RenderedTemplate {
  subject: string;
  bodyText: string;
}

/**
 * Render a stored template with placeholders filled in, but don't send.
 * Used by the admin "preview & edit" flow so an organizer can review
 * (and tweak) the draft before it goes out.
 */
export async function renderGearTemplateEmail(args: {
  templateKey: GearEmailTemplateKey;
  reservation: ReservationLike;
  lines: LineLike[];
  extraPlaceholders?: Record<string, string>;
}): Promise<
  { ok: true; rendered: RenderedTemplate } | { ok: false; error: string }
> {
  const supabase = createAdminClient();

  const [templateRes, settingsRes] = await Promise.all([
    supabase
      .from("gear_email_templates")
      .select("subject, body")
      .eq("key", args.templateKey)
      .maybeSingle(),
    supabase
      .from("gear_settings")
      .select("key, value")
      .in("key", [
        "organization_name",
        "donation_url",
        "tentative_disclaimer",
      ]),
  ]);

  if (!templateRes.data) {
    return { ok: false, error: `template-not-found:${args.templateKey}` };
  }

  const settings = new Map<string, string>();
  for (const row of settingsRes.data ?? []) {
    const val = (row.value ?? "") as unknown;
    settings.set(row.key, typeof val === "string" ? val : String(val));
  }

  const placeholders = buildPlaceholders(
    args.reservation,
    args.lines,
    settings,
    args.extraPlaceholders ?? {}
  );

  return {
    ok: true,
    rendered: {
      subject: render(templateRes.data.subject ?? "", placeholders),
      bodyText: render(templateRes.data.body ?? "", placeholders),
    },
  };
}

/**
 * Send an already-rendered subject+body to the reservation's requester.
 * The admin preview-and-edit flow uses this after the organizer has
 * (optionally) tweaked the draft. `bodyText` is the source of truth —
 * we auto-derive HTML from it.
 */
export async function sendGearRawEmail(args: {
  reservation: Pick<ReservationLike, "requester_email" | "human_id">;
  subject: string;
  bodyText: string;
}): Promise<SendResult> {
  if (!client) {
    console.warn(
      "[gear-email] RESEND_API_KEY not set — skipping send",
      args.reservation.human_id
    );
    return { ok: false, error: "email-not-configured", subject: args.subject };
  }
  if (!FROM) {
    console.warn(
      "[gear-email] GEAR_EMAIL_FROM not set — skipping send",
      args.reservation.human_id
    );
    return {
      ok: false,
      error: "gear-email-from-not-set",
      subject: args.subject,
    };
  }

  const bodyHtml = textToHtml(args.bodyText);

  try {
    const emailOpts: Parameters<typeof client.emails.send>[0] = {
      from: FROM,
      to: args.reservation.requester_email,
      subject: args.subject,
      html: bodyHtml,
      text: args.bodyText,
    };
    if (REPLY_TO) emailOpts.replyTo = REPLY_TO;

    const { error } = await client.emails.send(emailOpts);
    if (error) return { ok: false, error: error.message, subject: args.subject };
    return { ok: true, subject: args.subject };
  } catch (e) {
    return { ok: false, error: (e as Error).message, subject: args.subject };
  }
}

export async function sendGearTemplateEmail(args: {
  templateKey: GearEmailTemplateKey;
  reservation: ReservationLike;
  lines: LineLike[];
  extraPlaceholders?: Record<string, string>;
}): Promise<SendResult> {
  const rendered = await renderGearTemplateEmail(args);
  if (!rendered.ok) return { ok: false, error: rendered.error };
  return sendGearRawEmail({
    reservation: args.reservation,
    subject: rendered.rendered.subject,
    bodyText: rendered.rendered.bodyText,
  });
}

function buildPlaceholders(
  r: ReservationLike,
  lines: LineLike[],
  settings: Map<string, string>,
  extra: Record<string, string>
): Record<string, string> {
  const pickup = new Date(r.pickup_at);
  const returnAt = new Date(r.return_at);
  const fmt: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  };

  const gearLines = lines
    .map((l) => {
      const unit = l.unit_contribution ?? 0;
      const line = l.line_full ?? 0;
      return `  • ${l.quantity} × ${l.name_snapshot}  ($${unit} each, $${line} total)`;
    })
    .join("\n");

  return {
    reservation_id: r.human_id,
    requester_name: r.requester_name,
    requester_email: r.requester_email,
    organization: r.organization ?? "",
    event_description: r.event_description ?? "",
    pickup_at: pickup.toLocaleString(undefined, fmt),
    return_at: returnAt.toLocaleString(undefined, fmt),
    contribution_total: String(r.contribution_total ?? 0),
    subtotal_full: String(r.subtotal_full ?? 0),
    gear_lines: gearLines,
    organization_name:
      settings.get("organization_name") || "Movement Infrastructure Project",
    donation_url: settings.get("donation_url") || "",
    tentative_disclaimer:
      settings.get("tentative_disclaimer") ||
      "This booking request isn't confirmed until an organizer follows up.",
    ...extra,
  };
}

function render(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => ctx[key] ?? "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert plain-text template output to a simple HTML block.
 * Preserves newlines, auto-links URLs, and gives paragraphs light spacing.
 */
function textToHtml(text: string): string {
  const escaped = escapeHtml(text);
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) =>
      `<a href="${url}" style="color:#39375b;text-decoration:underline;">${url}</a>`
  );
  const paragraphs = withLinks
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 14px 0;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-size:15px;line-height:1.6;">
    ${paragraphs}
  </div>
</body>
</html>`;
}

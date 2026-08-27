/**
 * Space-reservations transactional email — template renderer.
 *
 * Structural mirror of `src/lib/gear/email.ts`. Reads templates from
 * `spaces_email_templates`, fills in placeholders, and hands off to
 * `dispatchSpaceEmail` in `./messages.ts` for the actual send + log.
 *
 * Notably different from gear:
 *   - Four timestamps (load_in, event_start, event_end, load_out) instead of two
 *   - Per-space hourly rate, no per-line quantity
 *   - No follow-up-question flow in this initial version
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchSpaceEmail } from "@/lib/spaces/messages";

export type SpaceEmailTemplateKey =
  | "submission_ack"
  | "approve"
  | "deny"
  | "followup";

interface ReservationLike {
  id: string;
  human_id: string;
  requester_name: string;
  requester_email: string;
  event_description: string | null;
  load_in_at: string;
  event_start_at: string;
  event_end_at: string;
  load_out_at: string;
  hours_billed: number | null;
  contribution_total: number | null;
  subtotal_full: number | null;
  organization: string | null;
}

interface LineLike {
  name_snapshot: string;
  rate_per_hour: number | null;
  hours_billed: number | null;
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
 * Render a stored template with placeholders filled in without sending.
 * Used by the admin preview-and-edit flow.
 */
export async function renderSpaceTemplateEmail(args: {
  templateKey: SpaceEmailTemplateKey;
  reservation: ReservationLike;
  lines: LineLike[];
  extraPlaceholders?: Record<string, string>;
}): Promise<
  { ok: true; rendered: RenderedTemplate } | { ok: false; error: string }
> {
  const supabase = createAdminClient();

  const [templateRes, settingsRes] = await Promise.all([
    supabase
      .from("spaces_email_templates")
      .select("subject, body")
      .eq("key", args.templateKey)
      .maybeSingle(),
    supabase
      .from("spaces_settings")
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
 * Render + send in one shot. Logs the outbound message.
 */
export async function sendSpaceTemplateEmail(args: {
  templateKey: SpaceEmailTemplateKey;
  reservation: ReservationLike;
  lines: LineLike[];
  extraPlaceholders?: Record<string, string>;
}): Promise<SendResult> {
  const rendered = await renderSpaceTemplateEmail(args);
  if (!rendered.ok) return { ok: false, error: rendered.error };
  const result = await dispatchSpaceEmail({
    reservationId: args.reservation.id,
    humanId: args.reservation.human_id,
    toAddress: args.reservation.requester_email,
    subject: rendered.rendered.subject,
    bodyText: rendered.rendered.bodyText,
    templateKey: args.templateKey,
    actorEmail: null,
  });
  return {
    ok: result.ok,
    error: result.error,
    subject: rendered.rendered.subject,
  };
}

function buildPlaceholders(
  r: ReservationLike,
  lines: LineLike[],
  settings: Map<string, string>,
  extra: Record<string, string>
): Record<string, string> {
  const fmt: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  };
  const dt = (iso: string) => new Date(iso).toLocaleString(undefined, fmt);

  const spaceLines = lines
    .map((l) => {
      const rate = l.rate_per_hour ?? 0;
      const hours = l.hours_billed ?? 0;
      const line = l.line_full ?? 0;
      return `  • ${l.name_snapshot}  ($${rate}/hr × ${hours}h, $${line})`;
    })
    .join("\n");
  const spaceNames = lines.map((l) => l.name_snapshot).join(", ");

  return {
    // `{{human_id}}` is the canonical placeholder used in the seeded
    // templates; `{{reservation_id}}` is kept as a compatibility alias
    // so admins can pick either wording without breaking.
    human_id: r.human_id,
    reservation_id: r.human_id,
    requester_name: r.requester_name,
    requester_email: r.requester_email,
    organization: r.organization ?? "",
    event_description: r.event_description ?? "",
    load_in_at: dt(r.load_in_at),
    event_start_at: dt(r.event_start_at),
    event_end_at: dt(r.event_end_at),
    load_out_at: dt(r.load_out_at),
    hours_billed: String(r.hours_billed ?? 0),
    contribution_total: String(r.contribution_total ?? 0),
    subtotal_full: String(r.subtotal_full ?? 0),
    space_lines: spaceLines,
    space_names: spaceNames,
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

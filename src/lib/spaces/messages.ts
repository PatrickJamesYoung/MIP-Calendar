/**
 * Space-reservations outbound email dispatcher + message log.
 *
 * Structural mirror of `src/lib/gear/messages.ts`. Writes to
 * `spaces_email_messages` instead of `gear_email_messages` so gear and
 * space concerns stay decoupled. Reuses the shared Gmail and Resend
 * transports.
 *
 * Config (env), with gear-env fallbacks so a single Gmail refresh
 * token can serve both modules until the operator wants to split them:
 *
 *   SPACE_EMAIL_FROM  (falls back to GEAR_EMAIL_FROM)
 *   SPACE_REPLY_TO    (falls back to GEAR_REPLY_TO)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { resendSend, escapeHtml } from "@/lib/email/resend-client";
import {
  gmailFromAddress,
  gmailSend,
  isGmailConfigured,
} from "@/lib/email/gmail-client";

export interface DispatchArgs {
  reservationId: string;
  humanId: string;
  toAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  templateKey?: string;
  actorEmail?: string | null;
  threadId?: string;
  inReplyTo?: string;
}

export interface DispatchResult {
  ok: boolean;
  error?: string;
  transport: "gmail" | "resend";
  messageRowId: string | null;
}

const FALLBACK_FROM =
  process.env.SPACE_EMAIL_FROM ?? process.env.GEAR_EMAIL_FROM ?? "";
const FALLBACK_REPLY_TO =
  process.env.SPACE_REPLY_TO ?? process.env.GEAR_REPLY_TO ?? "";

export async function dispatchSpaceEmail(
  args: DispatchArgs
): Promise<DispatchResult> {
  const bodyHtml = args.bodyHtml ?? textToHtml(args.bodyText);
  const supabase = createAdminClient();

  if (isGmailConfigured()) {
    return sendViaGmailAndLog(supabase, args, bodyHtml);
  }
  return sendViaResendAndLog(supabase, args, bodyHtml);
}

async function sendViaGmailAndLog(
  supabase: ReturnType<typeof createAdminClient>,
  args: DispatchArgs,
  bodyHtml: string
): Promise<DispatchResult> {
  const from = gmailFromAddress();
  const result = await gmailSend({
    to: args.toAddress,
    subject: args.subject,
    bodyText: args.bodyText,
    bodyHtml,
    threadId: args.threadId,
    inReplyTo: args.inReplyTo,
  });

  const base = {
    reservation_id: args.reservationId,
    direction: "outbound" as const,
    transport: "gmail" as const,
    from_address: from,
    to_address: args.toAddress,
    reply_to: null,
    subject: args.subject,
    body_text: args.bodyText,
    body_html: bodyHtml,
    template_key: args.templateKey ?? null,
    actor_email: args.actorEmail ?? null,
    in_reply_to: args.inReplyTo ?? null,
  };

  if (!result.ok) {
    const rowId = await insertMessage(supabase, {
      ...base,
      error: result.error,
      sent_at: null,
      gmail_message_id: null,
      gmail_thread_id: args.threadId ?? null,
    });
    console.warn(
      "[space-email] gmail send failed",
      args.humanId,
      "→",
      result.error
    );
    return {
      ok: false,
      error: result.error,
      transport: "gmail",
      messageRowId: rowId,
    };
  }

  const rowId = await insertMessage(supabase, {
    ...base,
    error: null,
    sent_at: new Date().toISOString(),
    gmail_message_id: result.messageId,
    gmail_thread_id: result.threadId,
  });

  return { ok: true, transport: "gmail", messageRowId: rowId };
}

async function sendViaResendAndLog(
  supabase: ReturnType<typeof createAdminClient>,
  args: DispatchArgs,
  bodyHtml: string
): Promise<DispatchResult> {
  if (!FALLBACK_FROM) {
    console.warn(
      "[space-email] neither gmail nor resend configured — skipping send",
      args.humanId
    );
    const rowId = await insertMessage(supabase, {
      reservation_id: args.reservationId,
      direction: "outbound",
      transport: "resend",
      from_address: FALLBACK_FROM,
      to_address: args.toAddress,
      reply_to: FALLBACK_REPLY_TO || null,
      subject: args.subject,
      body_text: args.bodyText,
      body_html: bodyHtml,
      template_key: args.templateKey ?? null,
      actor_email: args.actorEmail ?? null,
      in_reply_to: args.inReplyTo ?? null,
      error: "space-email-from-not-set",
      sent_at: null,
      gmail_message_id: null,
      gmail_thread_id: null,
    });
    return {
      ok: false,
      error: "space-email-from-not-set",
      transport: "resend",
      messageRowId: rowId,
    };
  }

  const result = await resendSend({
    from: FALLBACK_FROM,
    to: args.toAddress,
    subject: args.subject,
    html: bodyHtml,
    text: args.bodyText,
    replyTo: FALLBACK_REPLY_TO || undefined,
    logTag: args.humanId,
  });

  const rowId = await insertMessage(supabase, {
    reservation_id: args.reservationId,
    direction: "outbound",
    transport: "resend",
    from_address: FALLBACK_FROM,
    to_address: args.toAddress,
    reply_to: FALLBACK_REPLY_TO || null,
    subject: args.subject,
    body_text: args.bodyText,
    body_html: bodyHtml,
    template_key: args.templateKey ?? null,
    actor_email: args.actorEmail ?? null,
    in_reply_to: args.inReplyTo ?? null,
    error: result.ok ? null : result.error ?? null,
    sent_at: result.ok ? new Date().toISOString() : null,
    gmail_message_id: null,
    gmail_thread_id: null,
  });

  return {
    ok: result.ok,
    error: result.error,
    transport: "resend",
    messageRowId: rowId,
  };
}

interface MessageRow {
  reservation_id: string;
  direction: "outbound" | "inbound";
  transport: "gmail" | "resend";
  from_address: string;
  to_address: string;
  reply_to: string | null;
  subject: string;
  body_text: string;
  body_html: string | null;
  template_key: string | null;
  actor_email: string | null;
  in_reply_to: string | null;
  error: string | null;
  sent_at: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
}

async function insertMessage(
  supabase: ReturnType<typeof createAdminClient>,
  row: MessageRow
): Promise<string | null> {
  const { data, error } = await supabase
    .from("spaces_email_messages")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    console.error(
      "[space-email] failed to log message row",
      row.subject,
      error.message
    );
    return null;
  }
  return (data as { id: string }).id;
}

function textToHtml(text: string): string {
  const escaped = escapeHtml(text);
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) =>
      `<a href="${url}" style="color:#39375b;text-decoration:underline;">${url}</a>`
  );
  const paragraphs = withLinks
    .split(/\n\n+/)
    .map(
      (p) => `<p style="margin:0 0 14px 0;">${p.replace(/\n/g, "<br>")}</p>`
    )
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

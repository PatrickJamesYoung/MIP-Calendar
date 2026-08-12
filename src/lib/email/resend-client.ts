/**
 * Shared Resend transport for every transactional email in the app.
 *
 * Two callers exist today:
 *   - `src/lib/email.ts` (calendar submissions + admin ingest notify + admin invite)
 *   - `src/lib/gear/email.ts` (gear reservation lifecycle)
 *
 * Both used to instantiate their own `Resend` client and duplicate the
 * "no api key" no-op branch, `escapeHtml`, and the error-normalization
 * pattern. This module owns the transport so the higher-level helpers
 * only carry their own template shape.
 *
 * Config (env):
 *   RESEND_API_KEY  — API key from resend.com. If unset, `resendSend`
 *                     no-ops with a warning so preview/dev deploys don't
 *                     crash when the caller hits a send path.
 */

import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const client = apiKey ? new Resend(apiKey) : null;

export interface ResendSendArgs {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /**
   * Short label included in the "skipping send" warning when the client
   * is not configured — e.g. a reservation human_id or an event title.
   * Only used for diagnostics; never sent.
   */
  logTag?: string;
}

export interface ResendSendResult {
  ok: boolean;
  error?: string;
}

/**
 * Send one transactional email through Resend.
 *
 * If `RESEND_API_KEY` is not configured, this no-ops (logs a warning and
 * returns `{ ok: false, error: "email-not-configured" }`). Callers should
 * treat that as a soft failure — the primary user flow should still succeed.
 *
 * The Resend SDK throws on network errors and returns `{ error }` on API
 * errors; both are normalized to `{ ok: false, error }` here.
 */
export async function resendSend(args: ResendSendArgs): Promise<ResendSendResult> {
  if (!client) {
    console.warn(
      "[email] RESEND_API_KEY not set — skipping send",
      args.logTag ? `(${args.logTag})` : "",
      args.subject
    );
    return { ok: false, error: "email-not-configured" };
  }

  try {
    const opts: Parameters<typeof client.emails.send>[0] = {
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    };
    if (args.replyTo) opts.replyTo = args.replyTo;

    const { error } = await client.emails.send(opts);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * HTML-escape a string. Shared by every email template.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

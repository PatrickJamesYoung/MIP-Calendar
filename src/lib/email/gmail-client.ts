/**
 * Minimal Gmail API client.
 *
 * We use Gmail (not Resend) as the primary transport for gear-library
 * mail so that:
 *   - Sends appear in the shared info@ inbox's Sent folder, giving
 *     organizers full visibility.
 *   - Replies land in the shared inbox where our cron poll (PR C) can
 *     pick them up and thread them onto the reservation.
 *
 * The auth model is a single Google Cloud OAuth 2.0 client + one long-
 * lived refresh token minted by info@movementinfrastructureproject.org
 * during first-time consent. Vercel stores the refresh token as an env
 * var; this module trades it for a short-lived access token on demand
 * and caches the access token in-process for its lifetime.
 *
 * Config (env):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GMAIL_REFRESH_TOKEN         — one-time consent output for info@…
 *   GEAR_GMAIL_FROM             — e.g. "MIP Gear Library <info@movementinfrastructureproject.org>"
 *
 * If any of the four are unset, `isGmailConfigured()` returns false and
 * callers fall back to the existing Resend transport. That means this
 * PR is safe to deploy before Google Cloud setup is finished — the
 * behavior just doesn't change until env vars land.
 *
 * We intentionally do NOT depend on `googleapis` — the two REST calls
 * we need (token refresh + messages.send) are trivial, and the full
 * SDK would add ~10 MB to the serverless bundle.
 */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}
let cached: CachedToken | null = null;

export function isGmailConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN &&
      process.env.GEAR_GMAIL_FROM
  );
}

export function gmailFromAddress(): string {
  return process.env.GEAR_GMAIL_FROM ?? "";
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt - 30_000 > now) return cached.accessToken;

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    // token refresh should be fast; time out aggressively so a Google
    // outage doesn't hang admin actions
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `gmail-oauth-refresh-failed: ${res.status} ${text.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cached = {
    accessToken: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cached.accessToken;
}

export interface GmailSendArgs {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  replyTo?: string;
  /**
   * If set, this send is a reply on an existing Gmail thread. Both are
   * needed: Gmail groups by `threadId`, but real clients also honor
   * `In-Reply-To` / `References` headers so the thread stays intact
   * outside of Gmail.
   */
  threadId?: string;
  inReplyTo?: string; // full Message-ID value including angle brackets
  references?: string; // space-separated list of Message-IDs
}

export interface GmailSendResult {
  ok: true;
  messageId: string; // Gmail's own message id (not the RFC5322 Message-ID)
  threadId: string;
}

export interface GmailSendFail {
  ok: false;
  error: string;
}

export async function gmailSend(
  args: GmailSendArgs
): Promise<GmailSendResult | GmailSendFail> {
  if (!isGmailConfigured()) {
    return { ok: false, error: "gmail-not-configured" };
  }

  const from = gmailFromAddress();
  const rfc822 = buildRfc822({
    from,
    to: args.to,
    subject: args.subject,
    bodyText: args.bodyText,
    bodyHtml: args.bodyHtml,
    replyTo: args.replyTo,
    inReplyTo: args.inReplyTo,
    references: args.references,
  });

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "gmail-oauth-refresh-failed",
    };
  }

  // gmail wants base64url of the RFC 822 message
  const raw = base64UrlEncode(rfc822);

  const payload: Record<string, unknown> = { raw };
  if (args.threadId) payload.threadId = args.threadId;

  const res = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `gmail-send-failed: ${res.status} ${text.slice(0, 300)}`,
    };
  }

  const json = (await res.json()) as { id: string; threadId: string };
  return { ok: true, messageId: json.id, threadId: json.threadId };
}

/**
 * Build an RFC 5322 message with a multipart/alternative body
 * (text + html). Kept intentionally minimal — no attachments, no
 * quoted-printable, no long-line wrapping. Gmail accepts UTF-8 CRLF.
 */
function buildRfc822(args: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const boundary = `mip_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const encodedSubject = encodeSubjectHeader(args.subject);

  const headers: string[] = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (args.replyTo) headers.push(`Reply-To: ${args.replyTo}`);
  if (args.inReplyTo) headers.push(`In-Reply-To: ${args.inReplyTo}`);
  if (args.references) headers.push(`References: ${args.references}`);

  const parts: string[] = [
    headers.join("\r\n"),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    args.bodyText,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    args.bodyHtml,
    "",
    `--${boundary}--`,
    "",
  ];
  return parts.join("\r\n");
}

/**
 * Encode a subject that might contain non-ASCII characters. If it's
 * pure ASCII, pass through unchanged; otherwise use RFC 2047 base64.
 * Prevents Gmail from silently mangling em-dashes and smart quotes.
 */
function encodeSubjectHeader(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const b64 = Buffer.from(subject, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

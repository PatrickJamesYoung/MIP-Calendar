/**
 * Calendar transactional email helpers.
 *
 * Wraps the shared Resend transport in `src/lib/email/resend-client.ts`
 * with the calendar-side templates: submitter notifications, admin
 * new-submission alerts, admin ingest-run summaries, and admin invites.
 *
 * Config (env):
 *   RESEND_API_KEY       — API key from resend.com (see resend-client)
 *   EMAIL_FROM           — e.g. "MIP Calendar <calendar@send.movementinfrastructureproject.org>"
 *                          For quick testing you can use "onboarding@resend.dev"
 *   ADMIN_NOTIFY_EMAILS  — comma-separated list of admin emails to CC on new-submission alerts
 */

import { resendSend, escapeHtml } from "@/lib/email/resend-client";

const FROM = process.env.EMAIL_FROM ?? "MIP Calendar <onboarding@resend.dev>";
const ADMIN_NOTIFY = (process.env.ADMIN_NOTIFY_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function send(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  return resendSend({
    from: FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

/**
 * Notify admins that a new submission has arrived.
 */
export async function notifyAdminsOfNewSubmission(args: {
  submissionId: string;
  submitterName: string;
  submitterEmail: string;
  eventTitle: string;
  siteUrl: string;
}) {
  if (ADMIN_NOTIFY.length === 0) {
    console.warn("[email] ADMIN_NOTIFY_EMAILS not set — no one will be notified of new submissions");
    return { ok: false, error: "no-admins-configured" };
  }
  const url = `${args.siteUrl}/admin/submissions`;
  const subject = `New event submission: ${args.eventTitle}`;
  const text =
    `${args.submitterName} (${args.submitterEmail}) submitted an event to MIP Calendar.\n\n` +
    `Event: ${args.eventTitle}\n\n` +
    `Review it: ${url}`;
  const html = wrapEmail(
    "New event submission",
    `
    <p><strong>${escapeHtml(args.submitterName)}</strong> (${escapeHtml(
      args.submitterEmail
    )}) submitted an event:</p>
    <p style="font-size:18px;font-weight:600;color:#39375b;margin:16px 0;">${escapeHtml(
      args.eventTitle
    )}</p>
    <p><a href="${url}" style="background:#39375b;color:#fff;padding:10px 18px;border-radius:7px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;">Review submission</a></p>
    `
  );
  return send({ to: ADMIN_NOTIFY, subject, html, text });
}

/**
 * Confirm to the submitter that their submission was received.
 */
export async function emailSubmitterReceived(args: {
  submitterName: string;
  submitterEmail: string;
  eventTitle: string;
}) {
  const subject = `We got your submission: ${args.eventTitle}`;
  const text =
    `Hi ${args.submitterName},\n\n` +
    `Thanks for submitting "${args.eventTitle}" to the MIP Movement Calendar. ` +
    `A calendar admin will review it within 3 business days. ` +
    `You'll get another email when it's approved (or if we need more info).\n\n` +
    `— MIP Movement Calendar`;
  const html = wrapEmail(
    "Submission received",
    `
    <p>Hi ${escapeHtml(args.submitterName)},</p>
    <p>Thanks for submitting <strong>${escapeHtml(
      args.eventTitle
    )}</strong> to the MIP Movement Calendar.</p>
    <p>A calendar admin will review it within <strong>3 business days</strong>. You'll get another email when it's approved (or if we need more info).</p>
    <p style="color:#6b7280;font-size:13px;margin-top:32px;">— MIP Movement Calendar</p>
    `
  );
  return send({ to: args.submitterEmail, subject, html, text });
}

/**
 * Notify submitter that their event was approved and published.
 */
export async function emailSubmitterApproved(args: {
  submitterName: string;
  submitterEmail: string;
  eventTitle: string;
  eventUrl: string;
}) {
  const subject = `Your event is live: ${args.eventTitle}`;
  const text =
    `Hi ${args.submitterName},\n\n` +
    `Your event "${args.eventTitle}" has been approved and published on the MIP Movement Calendar.\n\n` +
    `View it: ${args.eventUrl}\n\n` +
    `— MIP Movement Calendar`;
  const html = wrapEmail(
    "Your event is live",
    `
    <p>Hi ${escapeHtml(args.submitterName)},</p>
    <p>Your event <strong>${escapeHtml(
      args.eventTitle
    )}</strong> has been approved and published on the MIP Movement Calendar.</p>
    <p><a href="${args.eventUrl}" style="background:#39375b;color:#fff;padding:10px 18px;border-radius:7px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;">View your event</a></p>
    <p style="color:#6b7280;font-size:13px;margin-top:32px;">— MIP Movement Calendar</p>
    `
  );
  return send({ to: args.submitterEmail, subject, html, text });
}

/**
 * Notify submitter that their event was rejected with a reason.
 */
export async function emailSubmitterRejected(args: {
  submitterName: string;
  submitterEmail: string;
  eventTitle: string;
  reason: string;
}) {
  const subject = `About your submission: ${args.eventTitle}`;
  const text =
    `Hi ${args.submitterName},\n\n` +
    `Unfortunately we're not able to add "${args.eventTitle}" to the MIP Movement Calendar right now.\n\n` +
    `Reason: ${args.reason}\n\n` +
    `If you'd like to update your submission and try again, feel free to resubmit at any time.\n\n` +
    `— MIP Movement Calendar`;
  const html = wrapEmail(
    "About your submission",
    `
    <p>Hi ${escapeHtml(args.submitterName)},</p>
    <p>Unfortunately we're not able to add <strong>${escapeHtml(
      args.eventTitle
    )}</strong> to the MIP Movement Calendar right now.</p>
    <p style="background:#f9fafb;border-left:3px solid #39375b;padding:12px 16px;margin:16px 0;color:#111827;">${escapeHtml(
      args.reason
    ).replace(/\n/g, "<br>")}</p>
    <p>If you'd like to update your submission and try again, feel free to resubmit at any time.</p>
    <p style="color:#6b7280;font-size:13px;margin-top:32px;">— MIP Movement Calendar</p>
    `
  );
  return send({ to: args.submitterEmail, subject, html, text });
}

/**
 * Send a generic admin-only email. Used for ops notifications like
 * ingest-run summaries. Recipients come from ADMIN_NOTIFY_EMAILS.
 */
export async function sendAdminEmail(args: {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  preheader?: string;
}) {
  if (ADMIN_NOTIFY.length === 0) {
    console.warn("[email] ADMIN_NOTIFY_EMAILS not set \u2014 nowhere to send admin email");
    return { ok: false, error: "no-admins-configured" };
  }
  const html = wrapEmail(args.preheader ?? args.subject, args.bodyHtml);
  return send({
    to: ADMIN_NOTIFY,
    subject: args.subject,
    html,
    text: args.bodyText,
  });
}

/**
 * Send an admin-invite email with a magic acceptance link.
 * Recipient is the invitee, not ADMIN_NOTIFY_EMAILS.
 */
export async function sendAdminInvite(args: {
  toEmail: string;
  acceptUrl: string;
  invitedByName: string | null;
  invitedByEmail: string;
  expiresAt: Date;
}) {
  const inviterLabel = args.invitedByName?.trim()
    ? `${args.invitedByName} (${args.invitedByEmail})`
    : args.invitedByEmail;
  const expiryLabel = args.expiresAt.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "long",
    timeStyle: "short",
  });
  const subject = "You're invited to admin the MIP Movement Calendar";
  const html = wrapEmail(
    subject,
    `
    <p>${escapeHtml(inviterLabel)} has invited you to be an admin on the
    <a href="https://mip.la/calendar" style="color:#39375b;font-weight:600;">MIP Movement Calendar</a>.</p>
    <p>Admins can approve incoming events, edit/feature listings, and invite other admins.</p>
    <p style="margin:24px 0;">
      <a href="${escapeHtml(args.acceptUrl)}"
         style="display:inline-block;background:#39375b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">
        Accept invite &rarr;
      </a>
    </p>
    <p style="color:#6b7280;font-size:13px;">Click the button to create your account by setting a password, or sign in with Google if you prefer.</p>
    <p style="color:#6b7280;font-size:13px;">This link is single-use and expires ${escapeHtml(expiryLabel)} ET.</p>
    <p style="color:#6b7280;font-size:12px;margin-top:16px;">If you weren't expecting this, you can safely ignore this email.</p>
    `
  );
  const text =
    `${inviterLabel} invited you to be an admin on the MIP Movement Calendar.\n\n` +
    `Accept: ${args.acceptUrl}\n\n` +
    `This link is single-use and expires ${expiryLabel} ET. ` +
    `If you weren't expecting this, you can ignore it.`;
  return send({ to: args.toEmail, subject, html, text });
}

// ---------- helpers ----------

function wrapEmail(preheader: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${escapeHtml(preheader)}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="border-bottom:2px solid #39375b;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:18px;font-weight:700;color:#39375b;letter-spacing:0.3px;">MIP MOVEMENT CALENDAR</div>
    </div>
    <div style="font-size:15px;line-height:1.6;">
      ${body}
    </div>
  </div>
</body>
</html>`;
}



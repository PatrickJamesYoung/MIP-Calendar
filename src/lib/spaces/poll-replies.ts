/**
 * Gmail reply poller — spaces variant.
 *
 * Structural mirror of `src/lib/gear/poll-replies.ts`. Reads and writes
 * `spaces_email_messages` instead of `gear_email_messages`. See the
 * gear file for the design rationale (thread-id join, dedup via unique
 * index, non-mutating observer on info@).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractBodies,
  gmailGetMessage,
  gmailHeader,
  gmailListMessages,
  isGmailConfigured,
  type GmailMessage,
} from "@/lib/email/gmail-client";

const POLL_QUERY = "-from:me newer_than:2d";
const POLL_MAX_RESULTS = 50;

export interface PollResult {
  ok: boolean;
  error?: string;
  fetched: number;
  matched: number;
  inserted: number;
  skippedNoThread: number;
  skippedDuplicate: number;
  skippedErrors: string[];
}

export async function pollSpacesGmailReplies(): Promise<PollResult> {
  const result: PollResult = {
    ok: true,
    fetched: 0,
    matched: 0,
    inserted: 0,
    skippedNoThread: 0,
    skippedDuplicate: 0,
    skippedErrors: [],
  };

  if (!isGmailConfigured()) {
    return { ...result, ok: false, error: "gmail-not-configured" };
  }

  const list = await gmailListMessages({
    q: POLL_QUERY,
    maxResults: POLL_MAX_RESULTS,
  });
  if (!list.ok) return { ...result, ok: false, error: list.error };
  if (list.messageIds.length === 0) return result;

  const supabase = createAdminClient();
  const { data: threads, error: threadsErr } = await supabase
    .from("spaces_email_messages")
    .select("gmail_thread_id, reservation_id")
    .not("gmail_thread_id", "is", null);
  if (threadsErr) {
    return {
      ...result,
      ok: false,
      error: `db-threads: ${threadsErr.message}`,
    };
  }
  const threadToReservation = new Map<string, string>();
  for (const t of (threads ?? []) as Array<{
    gmail_thread_id: string;
    reservation_id: string | null;
  }>) {
    if (t.gmail_thread_id && t.reservation_id) {
      threadToReservation.set(t.gmail_thread_id, t.reservation_id);
    }
  }

  const { data: existing, error: existingErr } = await supabase
    .from("spaces_email_messages")
    .select("gmail_message_id")
    .not("gmail_message_id", "is", null);
  if (existingErr) {
    return {
      ...result,
      ok: false,
      error: `db-existing: ${existingErr.message}`,
    };
  }
  const seen = new Set<string>(
    ((existing ?? []) as Array<{ gmail_message_id: string | null }>)
      .map((r) => r.gmail_message_id)
      .filter((id): id is string => Boolean(id))
  );

  for (const id of list.messageIds) {
    if (seen.has(id)) {
      result.skippedDuplicate++;
      continue;
    }
    const got = await gmailGetMessage(id);
    if (!got.ok) {
      result.skippedErrors.push(`get ${id}: ${got.error}`);
      continue;
    }
    result.fetched++;
    const reservationId = threadToReservation.get(got.message.threadId);
    if (!reservationId) {
      result.skippedNoThread++;
      continue;
    }
    result.matched++;

    const insertErr = await persistInbound(
      supabase,
      got.message,
      reservationId
    );
    if (insertErr) {
      result.skippedErrors.push(`persist ${id}: ${insertErr}`);
      continue;
    }
    result.inserted++;
  }

  return result;
}

async function persistInbound(
  supabase: ReturnType<typeof createAdminClient>,
  message: GmailMessage,
  reservationId: string
): Promise<string | null> {
  const header = message.payload;
  const fromAddress = gmailHeader(header, "From");
  const toAddress = gmailHeader(header, "To");
  const ccAddress = gmailHeader(header, "Cc") || null;
  const subject = gmailHeader(header, "Subject");
  const inReplyTo = gmailHeader(header, "In-Reply-To") || null;
  const bodies = extractBodies(header);
  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date().toISOString();

  const { error } = await supabase.from("spaces_email_messages").insert({
    reservation_id: reservationId,
    direction: "inbound",
    transport: "gmail",
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId,
    in_reply_to: inReplyTo,
    from_address: fromAddress,
    to_address: toAddress,
    cc_address: ccAddress,
    reply_to: null,
    subject,
    body_text: bodies.text || message.snippet || "",
    body_html: bodies.html || null,
    template_key: null,
    actor_email: null,
    received_at: receivedAt,
    sent_at: null,
    error: null,
  });
  if (error) {
    if (error.code === "23505") return null;
    return error.message;
  }
  return null;
}

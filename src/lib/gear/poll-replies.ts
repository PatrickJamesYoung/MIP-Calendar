/**
 * Gmail reply poller.
 *
 * Polls the info@ mailbox on a cron cadence, finds messages that
 * belong to threads we've previously sent gear-library email on, and
 * writes each new reply into `gear_email_messages` with
 * direction='inbound'.
 *
 * Matching strategy: we join by `gmail_thread_id`. Every outbound row
 * we've written since PR B stores that column, so any reply Gmail
 * puts into the same thread lines up cleanly with the reservation
 * that originated it. No subject parsing, no header sniffing.
 *
 * Dedup: `gear_email_messages` has a partial UNIQUE(gmail_message_id)
 * index (from the PR B migration). Re-runs of the poller upsert with
 * `on conflict do nothing`, so repeated calls are idempotent.
 *
 * Scope: this only touches messages Gmail's server-side filter
 * `-from:me newer_than:2d` returns. We overlap the 15-minute cron by
 * two days so we can miss up to that long without losing a reply.
 * Beyond that horizon a manual reconciliation is fine — the volume
 * is tiny.
 *
 * The poller does NOT mark messages as read or otherwise mutate the
 * shared inbox. info@ is a real human inbox that other organizers
 * read; we observe only.
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

export async function pollGmailReplies(): Promise<PollResult> {
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

  // 1. Find candidate message ids
  const list = await gmailListMessages({
    q: POLL_QUERY,
    maxResults: POLL_MAX_RESULTS,
  });
  if (!list.ok) return { ...result, ok: false, error: list.error };
  if (list.messageIds.length === 0) return result;

  // 2. Pre-load the set of thread ids we care about so we can skip
  //    unrelated inbox mail without fetching the full message.
  const supabase = createAdminClient();
  const { data: threads, error: threadsErr } = await supabase
    .from("gear_email_messages")
    .select("gmail_thread_id, reservation_id")
    .not("gmail_thread_id", "is", null);
  if (threadsErr) {
    return { ...result, ok: false, error: `db-threads: ${threadsErr.message}` };
  }
  const threadToReservation = new Map<string, string>();
  for (const t of (threads ?? []) as Array<{
    gmail_thread_id: string;
    reservation_id: string | null;
  }>) {
    if (t.gmail_thread_id && t.reservation_id) {
      // If multiple outbounds share a thread, they'll share a
      // reservation too — set() is fine.
      threadToReservation.set(t.gmail_thread_id, t.reservation_id);
    }
  }

  // 3. Pre-load already-seen gmail_message_ids so we can skip without
  //    fetching Gmail again. Cheap: one query, tens of rows tops.
  const { data: existing, error: existingErr } = await supabase
    .from("gear_email_messages")
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

  // 4. Fetch + persist each candidate message.
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
      // Not a gear thread — normal inbox traffic. Skip silently.
      result.skippedNoThread++;
      continue;
    }
    result.matched++;

    const insertErr = await persistInbound(supabase, got.message, reservationId);
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

  const { error } = await supabase.from("gear_email_messages").insert({
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
    // Unique-constraint violation on gmail_message_id is a race with
    // an overlapping cron run — safe to ignore.
    if (error.code === "23505") return null;
    return error.message;
  }
  return null;
}

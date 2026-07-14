"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/turnstile";
import {
  notifyAdminsOfNewSubmission,
  emailSubmitterReceived,
} from "@/lib/email";

// zod schema — mirrors form fields
const submitSchema = z.object({
  // Submitter
  submitter_name: z.string().min(1).max(120),
  submitter_email: z.string().email().max(255),
  submitter_phone: z.string().max(40).optional().or(z.literal("")),

  // Event
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional().or(z.literal("")),
  starts_at_local: z.string().min(1), // "2026-07-20T18:00" (browser datetime-local)
  ends_at_local: z.string().optional().or(z.literal("")),
  all_day: z.enum(["on", "off"]).optional(),
  location_text: z.string().max(500).optional().or(z.literal("")),
  location_type: z.enum(["in_person", "online", "hybrid"]).optional().or(z.literal("")),
  cost: z.string().max(200).optional().or(z.literal("")),
  host_org: z.string().max(200).optional().or(z.literal("")),
  web_link: z.string().url().max(500).optional().or(z.literal("")),
  image_url: z.string().url().max(500).optional().or(z.literal("")),
  overlay_calendar_id: z.string().uuid().optional().or(z.literal("")),
  event_type_id: z.string().uuid().optional().or(z.literal("")),
  accessibility: z.array(z.string()).optional(),

  // Anti-abuse
  turnstile_token: z.string().optional().or(z.literal("")),
  // Honeypot — must be empty
  website: z.string().max(0).optional().or(z.literal("")),
});

export type SubmitResult =
  | { ok: true; submissionId: string }
  | { ok: false; error: string; fields?: Record<string, string> };

/**
 * Convert a datetime-local string (in America/New_York) to a UTC ISO string.
 * datetime-local values are naive (no timezone), so we interpret them as
 * America/New_York wall-clock time.
 */
function localToUtcIso(localStr: string, tz = "America/New_York"): string {
  // Parse the naive local string as UTC first
  const naive = new Date(`${localStr}:00Z`);
  // Determine the offset that tz uses at that instant
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(naive);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const asUtcOfSameWallClock = Date.UTC(
    parseInt(get("year"), 10),
    parseInt(get("month"), 10) - 1,
    parseInt(get("day"), 10),
    parseInt(get("hour"), 10) === 24 ? 0 : parseInt(get("hour"), 10),
    parseInt(get("minute"), 10),
    parseInt(get("second"), 10)
  );
  const offsetMs = asUtcOfSameWallClock - naive.getTime();
  return new Date(naive.getTime() - offsetMs).toISOString();
}

/**
 * Simple in-process rate limit — 5 submissions per IP per hour.
 * Reset on server restart, which is fine for a first pass. Later we can
 * back this with the submissions table itself (count rows by ip_address).
 */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateBucket = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { ok: boolean; retryInSec?: number } {
  const now = Date.now();
  const entry = rateBucket.get(ip);
  if (!entry || entry.resetAt < now) {
    rateBucket.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { ok: false, retryInSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { ok: true };
}

export async function submitEventAction(
  formData: FormData
): Promise<SubmitResult> {
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";
  const userAgent = headerList.get("user-agent") ?? null;

  // Honeypot
  const website = formData.get("website");
  if (typeof website === "string" && website.length > 0) {
    // Silently accept and drop — don't tip off bots
    console.warn("[submit] honeypot triggered from", ip);
    return { ok: true, submissionId: "honeypot" };
  }

  // Rate limit
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return {
      ok: false,
      error: `Too many submissions. Try again in ${Math.ceil(
        (rate.retryInSec ?? 0) / 60
      )} minutes.`,
    };
  }

  // Zod validation
  const raw = Object.fromEntries(formData);
  // accessibility is a multi-checkbox; pull as array separately
  const accessibility = formData.getAll("accessibility").map((v) => String(v));
  const parsed = submitSchema.safeParse({ ...raw, accessibility });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "form";
      fields[key] = issue.message;
    }
    return { ok: false, error: "Please fix the highlighted fields.", fields };
  }
  const data = parsed.data;

  // Turnstile
  const turnstile = await verifyTurnstile(
    data.turnstile_token || null,
    ip !== "unknown" ? ip : undefined
  );
  if (!turnstile.ok) {
    return { ok: false, error: turnstile.error };
  }

  // Build event payload (stored in submissions.event_payload as jsonb)
  const isAllDay = data.all_day === "on";
  let starts_at: string;
  let ends_at: string | null = null;
  try {
    starts_at = isAllDay
      ? localToUtcIso(`${data.starts_at_local.slice(0, 10)}T00:00`)
      : localToUtcIso(data.starts_at_local);
    if (data.ends_at_local) {
      ends_at = isAllDay
        ? localToUtcIso(`${data.ends_at_local.slice(0, 10)}T23:59`)
        : localToUtcIso(data.ends_at_local);
    }
  } catch (e) {
    return { ok: false, error: `Invalid date: ${(e as Error).message}` };
  }

  const event_payload = {
    title: data.title,
    description: data.description || null,
    starts_at,
    ends_at,
    all_day: isAllDay,
    timezone: "America/New_York",
    location_text: data.location_text || null,
    location_type: data.location_type || null,
    cost: data.cost || null,
    host_org: data.host_org || null,
    web_link: data.web_link || null,
    image_url: data.image_url || null,
    overlay_calendar_id: data.overlay_calendar_id || null,
    event_type_id: data.event_type_id || null,
    accessibility: accessibility.length > 0 ? accessibility : [],
  };

  // Insert
  const supabase = createAdminClient();
  const { data: inserted, error } = await supabase
    .from("submissions")
    .insert({
      submitter_name: data.submitter_name,
      submitter_email: data.submitter_email,
      submitter_phone: data.submitter_phone || null,
      event_payload,
      ip_address: ip !== "unknown" ? ip : null,
      user_agent: userAgent,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[submit] insert failed", error);
    return { ok: false, error: `Could not save submission: ${error?.message ?? "unknown"}` };
  }

  // Email (fire-and-forget — don't block the response)
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://mip-calendar.vercel.app";
  Promise.allSettled([
    emailSubmitterReceived({
      submitterName: data.submitter_name,
      submitterEmail: data.submitter_email,
      eventTitle: data.title,
    }),
    notifyAdminsOfNewSubmission({
      submissionId: inserted.id,
      submitterName: data.submitter_name,
      submitterEmail: data.submitter_email,
      eventTitle: data.title,
      siteUrl,
    }),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[submit] email failed", r.reason);
      }
    }
  });

  return { ok: true, submissionId: inserted.id };
}

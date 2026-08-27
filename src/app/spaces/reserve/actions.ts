"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendSpaceTemplateEmail } from "@/lib/spaces/email";

const reserveSchema = z.object({
  requester_name: z.string().min(1).max(120),
  requester_email: z.string().email().max(255),
  requester_phone: z.string().max(40).optional().or(z.literal("")),
  organization: z.string().max(200).optional().or(z.literal("")),
  event_description: z.string().min(1).max(2000),
  load_in_at: z.string().min(1),
  event_start_at: z.string().min(1),
  event_end_at: z.string().min(1),
  load_out_at: z.string().min(1),
  acknowledged_tentative: z.literal("true"),
  spaces: z.string().min(1).max(1000),
});

export type SubmitResult =
  | { ok: true; humanId: string }
  | { ok: false; error: string };

/**
 * Handles a public space-reservation submission. Mirrors the gear submit
 * action but for four timestamps and per-space hourly rates.
 *
 * Donation math:
 *   hours_used = max((load_out - load_in) / 3600, donation_min_hours)
 *   line_full  = rate_per_hour * hours_used            (per space)
 *   subtotal   = sum(line_full)
 *   total      = subtotal * contribution_multiplier    (no tier for spaces yet)
 */
export async function submitSpaceReservationAction(
  formData: FormData
): Promise<SubmitResult> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;

  const parsed = reserveSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first
        ? `${first.path.join(".") || "form"}: ${first.message}`
        : "Please check the form and try again.",
    };
  }
  const v = parsed.data;

  // ---- Turnstile ----------------------------------------------------------
  const token = (raw["cf-turnstile-response"] as string | undefined) ?? null;
  const h = await headers();
  const remoteIp =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    undefined;
  const captchaResult = await verifyTurnstile(token, remoteIp);
  if (!captchaResult.ok) {
    return { ok: false, error: `Captcha failed: ${captchaResult.error}` };
  }

  // ---- Timing validation --------------------------------------------------
  const loadIn = new Date(v.load_in_at);
  const eventStart = new Date(v.event_start_at);
  const eventEnd = new Date(v.event_end_at);
  const loadOut = new Date(v.load_out_at);
  if (
    Number.isNaN(loadIn.getTime()) ||
    Number.isNaN(eventStart.getTime()) ||
    Number.isNaN(eventEnd.getTime()) ||
    Number.isNaN(loadOut.getTime())
  ) {
    return { ok: false, error: "One or more times are invalid." };
  }
  if (eventStart < loadIn) {
    return { ok: false, error: "Event start must be at or after load-in." };
  }
  if (eventEnd <= eventStart) {
    return { ok: false, error: "Event end must be after event start." };
  }
  if (loadOut < eventEnd) {
    return { ok: false, error: "Load-out must be at or after event end." };
  }

  const supabase = createAdminClient();

  // ---- Settings ----------------------------------------------------------
  const { data: settingsRows, error: settingsErr } = await supabase
    .from("spaces_settings")
    .select("key,value")
    .in("key", ["donation_min_hours", "reservation_id_prefix"]);
  if (settingsErr) {
    return { ok: false, error: `Failed to load settings: ${settingsErr.message}` };
  }
  const s = new Map((settingsRows ?? []).map((r) => [r.key, r.value]));
  const minHours = Number(s.get("donation_min_hours") ?? 2);
  const idPrefix = (s.get("reservation_id_prefix") as string) ?? "SPACE";

  // ---- Resolve spaces -----------------------------------------------------
  const slugs = parseSpaceSlugs(v.spaces);
  if (slugs.length === 0) {
    return { ok: false, error: "No spaces selected." };
  }

  const { data: spaceRows, error: spacesErr } = await supabase
    .from("spaces")
    .select("id,slug,name,suggested_contribution_per_hour,active")
    .in("slug", slugs);
  if (spacesErr) {
    return { ok: false, error: `Failed to load spaces: ${spacesErr.message}` };
  }
  const bySlug = new Map((spaceRows ?? []).map((sp) => [sp.slug, sp]));

  interface ResolvedLine {
    space_id: string;
    slug: string;
    name_snapshot: string;
    rate_per_hour: number;
  }
  const lines: ResolvedLine[] = [];
  for (const slug of slugs) {
    const sp = bySlug.get(slug);
    if (!sp || !sp.active) {
      return {
        ok: false,
        error: `Space "${slug}" is no longer available. Please remove it and try again.`,
      };
    }
    lines.push({
      space_id: sp.id,
      slug: sp.slug,
      name_snapshot: sp.name,
      rate_per_hour: Number(sp.suggested_contribution_per_hour ?? 0),
    });
  }

  // ---- Donation calc ------------------------------------------------------
  const rawHours = (loadOut.getTime() - loadIn.getTime()) / 3_600_000;
  const hoursBilled = Math.max(Math.ceil(rawHours * 100) / 100, minHours);
  const rateSum = lines.reduce((sum, l) => sum + l.rate_per_hour, 0);
  const subtotal = Math.round(rateSum * hoursBilled * 100) / 100;
  const multiplier = 1;
  const contributionTotal = Math.round(subtotal * multiplier * 100) / 100;

  // ---- human_id -----------------------------------------------------------
  const humanId = await generateHumanId(supabase, idPrefix);

  // ---- Insert reservation -------------------------------------------------
  const { data: resInsert, error: insertErr } = await supabase
    .from("spaces_reservations")
    .insert({
      human_id: humanId,
      status: "tentative",
      requester_name: v.requester_name.trim(),
      requester_email: v.requester_email.trim().toLowerCase(),
      requester_phone: v.requester_phone?.trim() || null,
      organization: v.organization?.trim() || null,
      event_description: v.event_description.trim(),
      load_in_at: loadIn.toISOString(),
      event_start_at: eventStart.toISOString(),
      event_end_at: eventEnd.toISOString(),
      load_out_at: loadOut.toISOString(),
      hours_billed: hoursBilled,
      subtotal_full: subtotal,
      contribution_multiplier: multiplier,
      contribution_total: contributionTotal,
      acknowledged_tentative: true,
    })
    .select("id, human_id")
    .single();

  if (insertErr || !resInsert) {
    return {
      ok: false,
      error: `Couldn't save your request: ${insertErr?.message ?? "unknown error"}`,
    };
  }

  const { error: linesErr } = await supabase
    .from("spaces_reservation_lines")
    .insert(
      lines.map((l) => ({
        reservation_id: resInsert.id,
        space_id: l.space_id,
        name_snapshot: l.name_snapshot,
        rate_per_hour: l.rate_per_hour,
        hours_billed: hoursBilled,
        line_full: Math.round(l.rate_per_hour * hoursBilled * 100) / 100,
      }))
    );
  if (linesErr) {
    // Best-effort rollback
    await supabase.from("spaces_reservations").delete().eq("id", resInsert.id);
    return {
      ok: false,
      error: `Couldn't save your spaces: ${linesErr.message}`,
    };
  }

  // ---- Ack email (best-effort) -------------------------------------------
  const ackReservation = {
    id: resInsert.id,
    human_id: resInsert.human_id,
    requester_name: v.requester_name,
    requester_email: v.requester_email.trim().toLowerCase(),
    event_description: v.event_description,
    load_in_at: loadIn.toISOString(),
    event_start_at: eventStart.toISOString(),
    event_end_at: eventEnd.toISOString(),
    load_out_at: loadOut.toISOString(),
    hours_billed: hoursBilled,
    contribution_total: contributionTotal,
    subtotal_full: subtotal,
    organization: v.organization?.trim() || null,
  };
  const ackLines = lines.map((l) => ({
    name_snapshot: l.name_snapshot,
    rate_per_hour: l.rate_per_hour,
    hours_billed: hoursBilled,
    line_full: Math.round(l.rate_per_hour * hoursBilled * 100) / 100,
  }));

  try {
    await sendSpaceTemplateEmail({
      templateKey: "submission_ack",
      reservation: ackReservation,
      lines: ackLines,
    });
  } catch (e) {
    console.warn("[spaces-reserve] submission_ack failed:", (e as Error).message);
  }

  return { ok: true, humanId: resInsert.human_id };
}

function parseSpaceSlugs(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const slug = part.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

async function generateHumanId(
  supabase: ReturnType<typeof createAdminClient>,
  prefix: string
): Promise<string> {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const candidate = `${prefix}-${datePart}-${suffix}`;
    const { data, error } = await supabase
      .from("spaces_reservations")
      .select("id")
      .eq("human_id", candidate)
      .maybeSingle();
    if (error) throw new Error(`human_id lookup failed: ${error.message}`);
    if (!data) return candidate;
  }
  return `${prefix}-${datePart}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

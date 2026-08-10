"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendGearTemplateEmail } from "@/lib/gear/email";
import { notifyOrganizersOfNewGearRequest } from "@/lib/gear/notify";
import { parseCart } from "./cart";

const reserveSchema = z.object({
  requester_name: z.string().min(1).max(120),
  requester_email: z.string().email().max(255),
  requester_phone: z.string().max(40).optional().or(z.literal("")),
  organization: z.string().max(200).optional().or(z.literal("")),
  org_tier: z.enum(["full", "mid", "low"]),
  event_description: z.string().min(1).max(2000),
  pickup_at: z.string().min(1),
  return_at: z.string().min(1),
  pickup_location: z.string().max(300).optional().or(z.literal("")),
  organizer_contact_name: z.string().max(200).optional().or(z.literal("")),
  organizer_contact_phone: z.string().max(40).optional().or(z.literal("")),
  acknowledged_tentative: z.literal("true"),
  cart: z.string().min(1).max(2000),
});

export type SubmitResult =
  | { ok: true; humanId: string }
  | { ok: false; error: string };

export async function submitReservationAction(
  formData: FormData
): Promise<SubmitResult> {
  // ---- 1. Parse + validate form ------------------------------------------
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

  // ---- 2. Turnstile ------------------------------------------------------
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

  // ---- 3. Timing validation ---------------------------------------------
  const pickup = new Date(v.pickup_at);
  const rtn = new Date(v.return_at);
  if (Number.isNaN(pickup.getTime()) || Number.isNaN(rtn.getTime())) {
    return { ok: false, error: "Invalid pickup or return date." };
  }
  if (rtn <= pickup) {
    return { ok: false, error: "Return time must be after pickup time." };
  }

  const supabase = createAdminClient();

  // ---- 4. Fetch settings needed for pricing + notice check --------------
  const { data: settingsRows, error: settingsErr } = await supabase
    .from("gear_settings")
    .select("key,value")
    .in("key", [
      "min_notice_hours",
      "tier_full_multiplier",
      "tier_mid_multiplier",
      "tier_low_multiplier",
      "tier_multipliers",
    ]);
  if (settingsErr) {
    return { ok: false, error: `Failed to load settings: ${settingsErr.message}` };
  }
  const s = new Map((settingsRows ?? []).map((r) => [r.key, r.value]));
  const minNoticeHours = (s.get("min_notice_hours") as number) ?? 48;

  const now = new Date();
  const hoursNotice = (pickup.getTime() - now.getTime()) / 3_600_000;
  if (hoursNotice < minNoticeHours) {
    return {
      ok: false,
      error: `Pickup must be at least ${minNoticeHours} hours from now. Please pick a later time.`,
    };
  }

  const multiplierByTier: Record<string, number> = {
    full: (s.get("tier_full_multiplier") as number) ?? 1,
    mid: (s.get("tier_mid_multiplier") as number) ?? 0.85,
    low: (s.get("tier_low_multiplier") as number) ?? 0.65,
  };
  const multiplier = multiplierByTier[v.org_tier] ?? 1;

  // ---- 5. Resolve cart against catalog ----------------------------------
  const cartEntries = parseCart(v.cart);
  if (cartEntries.length === 0) {
    return { ok: false, error: "Your cart is empty." };
  }
  const slugs = cartEntries.map((c) => c.slug);
  const { data: itemsData, error: itemsErr } = await supabase
    .from("gear_items")
    .select(
      "id,slug,name,quantity_total,suggested_contribution,unit,active"
    )
    .in("slug", slugs);
  if (itemsErr) {
    return { ok: false, error: `Failed to load items: ${itemsErr.message}` };
  }
  const bySlug = new Map((itemsData ?? []).map((it) => [it.slug, it]));

  interface ResolvedLine {
    item_id: string;
    name_snapshot: string;
    quantity: number;
    unit_contribution: number;
    line_full: number;
  }
  const lines: ResolvedLine[] = [];
  for (const entry of cartEntries) {
    const it = bySlug.get(entry.slug);
    if (!it || !it.active) {
      return {
        ok: false,
        error: `Item "${entry.slug}" is no longer available. Please remove it and try again.`,
      };
    }
    const qty = Math.max(1, Math.min(entry.quantity, it.quantity_total));
    const unit = Number(it.suggested_contribution ?? 0);
    lines.push({
      item_id: it.id,
      name_snapshot: it.name,
      quantity: qty,
      unit_contribution: unit,
      line_full: qty * unit,
    });
  }

  const subtotalFull = lines.reduce((sum, l) => sum + l.line_full, 0);
  const contributionTotal = Math.round(subtotalFull * multiplier * 100) / 100;

  // ---- 6. Generate a human_id -------------------------------------------
  const humanId = await generateHumanId(supabase);

  // ---- 7. Insert reservation + lines ------------------------------------
  const { data: resInsert, error: insertErr } = await supabase
    .from("gear_reservations")
    .insert({
      human_id: humanId,
      status: "tentative",
      requester_name: v.requester_name.trim(),
      requester_email: v.requester_email.trim().toLowerCase(),
      requester_phone: v.requester_phone?.trim() || null,
      organization: v.organization?.trim() || null,
      org_tier: v.org_tier,
      event_description: v.event_description.trim(),
      pickup_at: pickup.toISOString(),
      return_at: rtn.toISOString(),
      pickup_location: v.pickup_location?.trim() || null,
      organizer_contact_name: v.organizer_contact_name?.trim() || null,
      organizer_contact_phone: v.organizer_contact_phone?.trim() || null,
      subtotal_full: subtotalFull,
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

  const { error: linesErr } = await supabase.from("gear_reservation_lines").insert(
    lines.map((l) => ({
      reservation_id: resInsert.id,
      line_type: "item" as const,
      item_id: l.item_id,
      name_snapshot: l.name_snapshot,
      quantity: l.quantity,
      unit_contribution: l.unit_contribution,
      line_full: l.line_full,
    }))
  );
  if (linesErr) {
    // Best-effort rollback: delete the reservation row so we don't leave orphans
    await supabase.from("gear_reservations").delete().eq("id", resInsert.id);
    return {
      ok: false,
      error: `Couldn't save your items: ${linesErr.message}`,
    };
  }

  // ---- 8. Send acknowledgement + notify organizers (best-effort) --------
  const ackReservation = {
    id: resInsert.id,
    human_id: resInsert.human_id,
    requester_name: v.requester_name,
    requester_email: v.requester_email.trim().toLowerCase(),
    event_description: v.event_description,
    pickup_at: pickup.toISOString(),
    return_at: rtn.toISOString(),
    contribution_total: contributionTotal,
    subtotal_full: subtotalFull,
    organization: v.organization?.trim() || null,
  };
  const ackLines = lines.map((l) => ({
    name_snapshot: l.name_snapshot,
    quantity: l.quantity,
    unit_contribution: l.unit_contribution,
    line_full: l.line_full,
  }));

  // Don't block the response on email failures.
  try {
    await sendGearTemplateEmail({
      templateKey: "submission_ack",
      reservation: ackReservation,
      lines: ackLines,
    });
  } catch (e) {
    console.warn("[gear-reserve] submission_ack failed:", (e as Error).message);
  }

  try {
    await notifyOrganizersOfNewGearRequest({
      reservation: ackReservation,
      lines: ackLines,
      orgTier: v.org_tier,
    });
  } catch (e) {
    console.warn("[gear-reserve] organizer notify failed:", (e as Error).message);
  }

  return { ok: true, humanId: resInsert.human_id };
}

/**
 * Generates a MIP-YYYYMMDD-XXXX identifier. Uses a small retry loop
 * against the unique constraint on gear_reservations.human_id in case
 * of collision (extremely unlikely at our volume).
 */
async function generateHumanId(
  supabase: ReturnType<typeof createAdminClient>
): Promise<string> {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const candidate = `MIP-${datePart}-${suffix}`;
    const { data, error } = await supabase
      .from("gear_reservations")
      .select("id")
      .eq("human_id", candidate)
      .maybeSingle();
    if (error) throw new Error(`human_id lookup failed: ${error.message}`);
    if (!data) return candidate;
  }
  // Fallback — extremely unlikely to reach
  return `MIP-${datePart}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendGearTemplateEmail,
  type GearEmailTemplateKey,
} from "@/lib/gear/email";

/**
 * Server actions for the reservation detail page.
 *
 * Every action calls requireAdmin(), writes a gear_activity row, and
 * revalidatePath(). Actions that send email record whether the send
 * succeeded in the audit log detail column.
 */

type Status =
  | "tentative"
  | "approved"
  | "denied"
  | "picked_up"
  | "returned"
  | "cancelled";

interface Reservation {
  id: string;
  human_id: string;
  status: Status;
  requester_name: string;
  requester_email: string;
  event_description: string | null;
  pickup_at: string;
  return_at: string;
  contribution_total: number | null;
  subtotal_full: number | null;
  organization: string | null;
}

interface Line {
  name_snapshot: string;
  quantity: number;
  unit_contribution: number | null;
  line_full: number | null;
}

async function loadForEmail(
  supabase: ReturnType<typeof createAdminClient>,
  reservationId: string
): Promise<{ reservation: Reservation; lines: Line[] } | null> {
  const [{ data: reservation }, { data: lines }] = await Promise.all([
    supabase.from("gear_reservations").select("*").eq("id", reservationId).maybeSingle(),
    supabase
      .from("gear_reservation_lines")
      .select("name_snapshot,quantity,unit_contribution,line_full")
      .eq("reservation_id", reservationId),
  ]);
  if (!reservation) return null;
  return { reservation: reservation as Reservation, lines: (lines ?? []) as Line[] };
}

async function logActivity(args: {
  supabase: ReturnType<typeof createAdminClient>;
  reservationId: string;
  actorEmail: string | null;
  action: string;
  detail?: Record<string, unknown>;
}) {
  await args.supabase.from("gear_activity").insert({
    reservation_id: args.reservationId,
    actor_email: args.actorEmail,
    action: args.action,
    detail: args.detail ?? null,
  });
}

async function updateStatus(
  supabase: ReturnType<typeof createAdminClient>,
  reservationId: string,
  status: Status
) {
  const { error } = await supabase
    .from("gear_reservations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", reservationId);
  if (error) throw new Error(`Failed to update status: ${error.message}`);
}

// ---------- APPROVE ----------

export async function approveReservation(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  if (!reservationId || !humanId) throw new Error("Missing reservation_id or human_id");

  const supabase = createAdminClient();
  await updateStatus(supabase, reservationId, "approved");

  const bundle = await loadForEmail(supabase, reservationId);
  let emailResult: { ok: boolean; error?: string } = { ok: false, error: "no-data" };
  if (bundle) {
    emailResult = await sendGearTemplateEmail({
      templateKey: "approve",
      reservation: bundle.reservation,
      lines: bundle.lines,
    });
  }

  await logActivity({
    supabase,
    reservationId,
    actorEmail: admin.email,
    action: "approved",
    detail: { email: emailResult },
  });

  revalidatePath(`/admin/gear/${humanId}`);
  revalidatePath("/admin/gear");
}

// ---------- DENY ----------

export async function denyReservation(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reservationId || !humanId) throw new Error("Missing reservation_id or human_id");

  const supabase = createAdminClient();
  await updateStatus(supabase, reservationId, "denied");

  const bundle = await loadForEmail(supabase, reservationId);
  let emailResult: { ok: boolean; error?: string } = { ok: false, error: "no-data" };
  if (bundle) {
    emailResult = await sendGearTemplateEmail({
      templateKey: "deny",
      reservation: bundle.reservation,
      lines: bundle.lines,
      extraPlaceholders: reason ? { reason } : undefined,
    });
  }

  await logActivity({
    supabase,
    reservationId,
    actorEmail: admin.email,
    action: "denied",
    detail: { email: emailResult, reason: reason || null },
  });

  revalidatePath(`/admin/gear/${humanId}`);
  revalidatePath("/admin/gear");
}

// ---------- MARK PICKED UP ----------

export async function markPickedUp(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  if (!reservationId || !humanId) throw new Error("Missing reservation_id or human_id");

  const supabase = createAdminClient();
  await updateStatus(supabase, reservationId, "picked_up");
  await logActivity({
    supabase,
    reservationId,
    actorEmail: admin.email,
    action: "picked_up",
  });

  revalidatePath(`/admin/gear/${humanId}`);
  revalidatePath("/admin/gear");
}

// ---------- MARK RETURNED ----------

export async function markReturned(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  if (!reservationId || !humanId) throw new Error("Missing reservation_id or human_id");

  const supabase = createAdminClient();
  await updateStatus(supabase, reservationId, "returned");
  await logActivity({
    supabase,
    reservationId,
    actorEmail: admin.email,
    action: "returned",
  });

  revalidatePath(`/admin/gear/${humanId}`);
  revalidatePath("/admin/gear");
}

// ---------- CANCEL ----------

export async function cancelReservation(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  if (!reservationId || !humanId) throw new Error("Missing reservation_id or human_id");

  const supabase = createAdminClient();
  await updateStatus(supabase, reservationId, "cancelled");
  await logActivity({
    supabase,
    reservationId,
    actorEmail: admin.email,
    action: "cancelled",
  });

  revalidatePath(`/admin/gear/${humanId}`);
  revalidatePath("/admin/gear");
}

// ---------- SEND FOLLOWUP ----------

export async function sendFollowup(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  if (!reservationId || !humanId) throw new Error("Missing reservation_id or human_id");

  const supabase = createAdminClient();
  const bundle = await loadForEmail(supabase, reservationId);
  let emailResult: { ok: boolean; error?: string } = { ok: false, error: "no-data" };
  if (bundle) {
    emailResult = await sendGearTemplateEmail({
      templateKey: "followup",
      reservation: bundle.reservation,
      lines: bundle.lines,
    });
  }

  await logActivity({
    supabase,
    reservationId,
    actorEmail: admin.email,
    action: "email_sent",
    detail: { template: "followup", email: emailResult },
  });

  revalidatePath(`/admin/gear/${humanId}`);
}

// ---------- RESEND TEMPLATE ----------

export async function resendTemplate(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  const templateKey = String(formData.get("template_key") ?? "") as GearEmailTemplateKey;
  if (!reservationId || !humanId || !templateKey) {
    throw new Error("Missing reservation_id, human_id, or template_key");
  }
  const allowed: GearEmailTemplateKey[] = ["submission_ack", "approve", "deny", "followup"];
  if (!allowed.includes(templateKey)) throw new Error(`Unknown template: ${templateKey}`);

  const supabase = createAdminClient();
  const bundle = await loadForEmail(supabase, reservationId);
  let emailResult: { ok: boolean; error?: string } = { ok: false, error: "no-data" };
  if (bundle) {
    emailResult = await sendGearTemplateEmail({
      templateKey,
      reservation: bundle.reservation,
      lines: bundle.lines,
    });
  }

  await logActivity({
    supabase,
    reservationId,
    actorEmail: admin.email,
    action: "email_resent",
    detail: { template: templateKey, email: emailResult },
  });

  revalidatePath(`/admin/gear/${humanId}`);
}

// ---------- UPDATE FIELDS (notes, pickup location, organizer contact) ----------

export async function updateReservationFields(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  if (!reservationId || !humanId) throw new Error("Missing reservation_id or human_id");

  const patch: Record<string, string | null> = {};
  const fields = [
    "pickup_location",
    "organizer_contact_name",
    "organizer_contact_phone",
    "internal_notes",
  ];
  for (const f of fields) {
    if (formData.has(f)) {
      const raw = String(formData.get(f) ?? "").trim();
      patch[f] = raw === "" ? null : raw;
    }
  }
  if (Object.keys(patch).length === 0) return;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("gear_reservations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", reservationId);
  if (error) throw new Error(`Failed to update reservation: ${error.message}`);

  await logActivity({
    supabase,
    reservationId,
    actorEmail: admin.email,
    action: "fields_updated",
    detail: { fields: Object.keys(patch) },
  });

  revalidatePath(`/admin/gear/${humanId}`);
}

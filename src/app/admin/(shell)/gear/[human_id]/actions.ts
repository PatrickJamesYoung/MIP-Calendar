"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  renderGearTemplateEmail,
  sendGearRawEmail,
  type GearEmailTemplateKey,
} from "@/lib/gear/email";

/**
 * Server actions for the reservation detail page.
 *
 * Design notes:
 *  - Status changes and emails are independent. Setting a reservation to
 *    `approved` no longer implicitly sends the approval email; the
 *    organizer sends emails explicitly via the "Send email" modal.
 *  - `prepareEmailDraft` renders a template with placeholders filled in
 *    but doesn't send; the client renders the result in an editable
 *    modal. `sendPreparedEmail` accepts a possibly-edited subject/body
 *    and does the actual Resend call.
 */

const STATUSES = [
  "tentative",
  "approved",
  "denied",
  "picked_up",
  "returned",
  "cancelled",
] as const;
type Status = (typeof STATUSES)[number];

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
    supabase
      .from("gear_reservations")
      .select("*")
      .eq("id", reservationId)
      .maybeSingle(),
    supabase
      .from("gear_reservation_lines")
      .select("name_snapshot,quantity,unit_contribution,line_full")
      .eq("reservation_id", reservationId),
  ]);
  if (!reservation) return null;
  return {
    reservation: reservation as Reservation,
    lines: (lines ?? []) as Line[],
  };
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

// ---------- STATUS UPDATE (no email side-effect) ----------

export async function updateReservationStatus(args: {
  reservationId: string;
  humanId: string;
  status: Status;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await requireAdmin();
  if (!args.reservationId || !args.humanId) {
    return { ok: false, error: "Missing reservation_id or human_id" };
  }
  if (!STATUSES.includes(args.status)) {
    return { ok: false, error: `Invalid status: ${args.status}` };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("gear_reservations")
    .update({ status: args.status, updated_at: new Date().toISOString() })
    .eq("id", args.reservationId);
  if (error) return { ok: false, error: error.message };

  await logActivity({
    supabase,
    reservationId: args.reservationId,
    actorEmail: admin.email,
    action: "status_changed",
    detail: { status: args.status },
  });

  revalidatePath(`/admin/gear/${args.humanId}`);
  revalidatePath("/admin/gear");
  return { ok: true };
}

// ---------- PREPARE EMAIL DRAFT (no send) ----------

export async function prepareEmailDraft(args: {
  reservationId: string;
  templateKey: GearEmailTemplateKey;
  extraPlaceholders?: Record<string, string>;
}): Promise<
  | { ok: true; subject: string; bodyText: string; recipient: string }
  | { ok: false; error: string }
> {
  await requireAdmin();
  const supabase = createAdminClient();
  const bundle = await loadForEmail(supabase, args.reservationId);
  if (!bundle) return { ok: false, error: "Reservation not found" };

  const rendered = await renderGearTemplateEmail({
    templateKey: args.templateKey,
    reservation: bundle.reservation,
    lines: bundle.lines,
    extraPlaceholders: args.extraPlaceholders,
  });
  if (!rendered.ok) return { ok: false, error: rendered.error };

  return {
    ok: true,
    subject: rendered.rendered.subject,
    bodyText: rendered.rendered.bodyText,
    recipient: bundle.reservation.requester_email,
  };
}

// ---------- SEND PREPARED EMAIL (with possibly-edited body) ----------

export async function sendPreparedEmail(args: {
  reservationId: string;
  humanId: string;
  templateKey: GearEmailTemplateKey;
  subject: string;
  bodyText: string;
}): Promise<
  { ok: true; subject: string } | { ok: false; error: string }
> {
  const admin = await requireAdmin();
  if (!args.reservationId || !args.humanId) {
    return { ok: false, error: "Missing reservation_id or human_id" };
  }
  const subject = args.subject.trim();
  const body = args.bodyText.trim();
  if (!subject) return { ok: false, error: "Subject is required" };
  if (!body) return { ok: false, error: "Body is required" };

  const supabase = createAdminClient();
  const { data: reservation } = await supabase
    .from("gear_reservations")
    .select("id, human_id, requester_email")
    .eq("id", args.reservationId)
    .maybeSingle();
  if (!reservation) return { ok: false, error: "Reservation not found" };

  const result = await sendGearRawEmail({
    reservation: {
      requester_email: reservation.requester_email,
      human_id: reservation.human_id,
    },
    subject,
    bodyText: body,
  });

  await logActivity({
    supabase,
    reservationId: args.reservationId,
    actorEmail: admin.email,
    action: "email_sent",
    detail: {
      template: args.templateKey,
      email: result,
      // Signal whether the organizer edited the draft (roughly).
      edited: subject.length + body.length > 0,
    },
  });

  revalidatePath(`/admin/gear/${args.humanId}`);
  if (!result.ok) return { ok: false, error: result.error ?? "Send failed" };
  return { ok: true, subject: result.subject ?? subject };
}

// ---------- UPDATE FIELDS (notes, pickup location, contact) ----------

export async function updateReservationFields(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  if (!reservationId || !humanId)
    throw new Error("Missing reservation_id or human_id");

  const patch: Record<string, string | null> = {};
  const fields = [
    "requester_name",
    "requester_phone",
    "pickup_location",
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

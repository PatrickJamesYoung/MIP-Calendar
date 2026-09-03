"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  renderSpaceTemplateEmail,
  type SpaceEmailTemplateKey,
} from "@/lib/spaces/email";
import { dispatchSpaceEmail } from "@/lib/spaces/messages";
import {
  pushReservationToGcal,
  unpushReservationFromGcal,
} from "@/lib/gcal/sync";

/**
 * Server actions for the space-reservation detail page.
 *
 * Mirrors `src/app/admin/(shell)/gear/[human_id]/actions.ts` but simpler:
 *  - status enum is different
 *  - fields writable via the basic edit form differ (no pickup_location,
 *    no coupon_code, no org_tier here — those live in a full editor to
 *    be added later)
 *  - no per-field "we changed your event time" notification emails; the
 *    organizer sends emails explicitly through the modal.
 */

const STATUSES = [
  "tentative",
  "approved",
  "denied",
  "in_use",
  "completed",
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
  load_in_at: string;
  event_start_at: string;
  event_end_at: string;
  load_out_at: string;
  hours_billed: number | null;
  contribution_total: number | null;
  subtotal_full: number | null;
  organization: string | null;
}

interface Line {
  name_snapshot: string;
  rate_per_hour: number | null;
  hours_billed: number | null;
  line_full: number | null;
}

async function loadForEmail(
  supabase: ReturnType<typeof createAdminClient>,
  reservationId: string
): Promise<{ reservation: Reservation; lines: Line[] } | null> {
  const [{ data: reservation }, { data: lines }] = await Promise.all([
    supabase
      .from("spaces_reservations")
      .select("*")
      .eq("id", reservationId)
      .maybeSingle(),
    supabase
      .from("spaces_reservation_lines")
      .select("name_snapshot,rate_per_hour,hours_billed,line_full")
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
  await args.supabase.from("spaces_activity").insert({
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
    .from("spaces_reservations")
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

  // Google Calendar side-effects. We treat 'approved' as the
  // confirmation state — that's when we push an event to the shared
  // calendar. Any move OUT of approved (denied/cancelled/completed)
  // deletes the event so the calendar stays in sync. All gcal errors
  // are non-fatal: they log as activity but the status change still
  // sticks so a Google outage can't wedge the admin queue.
  if (args.status === "approved") {
    const pushResult = await pushReservationToGcal(args.reservationId);
    await logActivity({
      supabase,
      reservationId: args.reservationId,
      actorEmail: admin.email,
      action: pushResult.ok ? "gcal_pushed" : "gcal_push_failed",
      detail: pushResult as unknown as Record<string, unknown>,
    });
  } else if (
    args.status === "denied" ||
    args.status === "cancelled" ||
    args.status === "completed"
  ) {
    const unpushResult = await unpushReservationFromGcal(args.reservationId);
    if (!unpushResult.ok || !unpushResult.skipped) {
      await logActivity({
        supabase,
        reservationId: args.reservationId,
        actorEmail: admin.email,
        action: unpushResult.ok
          ? "gcal_event_removed"
          : "gcal_remove_failed",
        detail: unpushResult as unknown as Record<string, unknown>,
      });
    }
  }

  revalidatePath(`/admin/spaces/${args.humanId}`);
  revalidatePath("/admin/spaces");
  return { ok: true };
}

// ---------- PREPARE EMAIL DRAFT (no send) ----------

export async function prepareEmailDraft(args: {
  reservationId: string;
  templateKey: SpaceEmailTemplateKey;
  extraPlaceholders?: Record<string, string>;
}): Promise<
  | { ok: true; subject: string; bodyText: string; recipient: string }
  | { ok: false; error: string }
> {
  await requireAdmin();
  const supabase = createAdminClient();
  const bundle = await loadForEmail(supabase, args.reservationId);
  if (!bundle) return { ok: false, error: "Reservation not found" };

  const rendered = await renderSpaceTemplateEmail({
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

// ---------- SEND PREPARED EMAIL (possibly-edited body) ----------

export async function sendPreparedEmail(args: {
  reservationId: string;
  humanId: string;
  templateKey: SpaceEmailTemplateKey;
  subject: string;
  bodyText: string;
}): Promise<{ ok: true; subject: string } | { ok: false; error: string }> {
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
    .from("spaces_reservations")
    .select("id, human_id, requester_email")
    .eq("id", args.reservationId)
    .maybeSingle();
  if (!reservation) return { ok: false, error: "Reservation not found" };

  const result = await dispatchSpaceEmail({
    reservationId: args.reservationId,
    humanId: reservation.human_id,
    toAddress: reservation.requester_email,
    subject,
    bodyText: body,
    templateKey: args.templateKey,
    actorEmail: admin.email,
  });

  await logActivity({
    supabase,
    reservationId: args.reservationId,
    actorEmail: admin.email,
    action: "email_sent",
    detail: {
      template: args.templateKey,
      email: {
        ok: result.ok,
        error: result.error,
        transport: result.transport,
      },
    },
  });

  revalidatePath(`/admin/spaces/${args.humanId}`);
  if (!result.ok) return { ok: false, error: result.error ?? "Send failed" };
  return { ok: true, subject };
}

// ---------- UPDATE FIELDS (basic edit form) ----------

export async function updateReservationFields(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  if (!reservationId || !humanId)
    throw new Error("Missing reservation_id or human_id");

  const patch: Record<string, string | null> = {};
  const stringFields = [
    "requester_name",
    "requester_email",
    "requester_phone",
    "organization",
    "event_title",
    "event_description",
    "internal_notes",
    "staffing_organizer",
  ];
  for (const f of stringFields) {
    if (formData.has(f)) {
      const raw = String(formData.get(f) ?? "").trim();
      patch[f] = raw === "" ? null : raw;
    }
  }

  const timestampFields = [
    "load_in_at",
    "event_start_at",
    "event_end_at",
    "load_out_at",
  ];
  for (const f of timestampFields) {
    if (formData.has(f)) {
      const raw = String(formData.get(f) ?? "").trim();
      // datetime-local values look like "2026-09-01T14:00"; convert to ISO.
      if (raw === "") {
        patch[f] = null;
      } else {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) patch[f] = d.toISOString();
      }
    }
  }

  if (Object.keys(patch).length === 0) return;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("spaces_reservations")
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

  revalidatePath(`/admin/spaces/${humanId}`);
}

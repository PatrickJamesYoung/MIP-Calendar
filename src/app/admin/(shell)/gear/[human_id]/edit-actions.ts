"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchGearEmail } from "@/lib/gear/messages";

/**
 * Full-edit server actions for gear reservations.
 *
 * PR A of the "admin edits + reply capture" pass. These actions let the
 * organizer update every user-facing field on a reservation from
 * /admin/gear/[human_id] — including line items — without going back to
 * SQL.
 *
 * Totals stay consistent with the storefront's own formula:
 *   line_full          = quantity × unit_contribution
 *   subtotal_full      = Σ line_full
 *   contribution_total = round(subtotal_full × multiplier, 2)
 *
 * Every action:
 *   1. Validates admin session via requireAdmin().
 *   2. Loads the reservation snapshot BEFORE the change.
 *   3. Applies the change.
 *   4. Optionally recomputes reservation totals.
 *   5. Logs a `reservation_edited` activity entry with a compact
 *      before/after diff so the Activity panel can render a real
 *      audit trail.
 *   6. Optionally sends a "your reservation has been updated" email to
 *      the organizer with the diff. Opt-in per submission via a
 *      `notify_organizer` form field.
 *
 * The email is a simple plaintext summary — the admin can always send a
 * fuller message from the "Send email" modal. The goal is a
 * lightweight "heads up, we changed X" ping.
 */

type Sb = ReturnType<typeof createAdminClient>;

type Status =
  | "tentative"
  | "approved"
  | "denied"
  | "picked_up"
  | "returned"
  | "cancelled";

interface ReservationRow {
  id: string;
  human_id: string;
  status: Status;
  requester_name: string;
  requester_email: string;
  requester_phone: string | null;
  organization: string | null;
  org_tier: string | null;
  event_description: string | null;
  pickup_at: string;
  return_at: string;
  pickup_location: string | null;
  subtotal_full: number;
  contribution_multiplier: number;
  contribution_total: number;
  coupon_code: string | null;
  internal_notes: string | null;
}

interface LineRow {
  id: string;
  reservation_id: string;
  line_type: "item" | "bundle";
  item_id: string | null;
  name_snapshot: string;
  quantity: number;
  unit_contribution: number;
  line_full: number;
  follow_up_answer: string | null;
}

type FieldDiff = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

// ─────────────── helpers ───────────────

async function logEdit(args: {
  supabase: Sb;
  reservationId: string;
  actorEmail: string | null;
  changes: FieldDiff[];
  extra?: Record<string, unknown>;
}) {
  await args.supabase.from("gear_activity").insert({
    reservation_id: args.reservationId,
    actor_email: args.actorEmail,
    action: "reservation_edited",
    detail: { changes: args.changes, ...(args.extra ?? {}) },
  });
}

function num(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nullIfBlank(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number | null): string {
  return `$${Number(n ?? 0).toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

async function loadReservation(
  supabase: Sb,
  reservationId: string
): Promise<ReservationRow | null> {
  const { data } = await supabase
    .from("gear_reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();
  return (data as ReservationRow | null) ?? null;
}

async function loadLines(supabase: Sb, reservationId: string): Promise<LineRow[]> {
  const { data } = await supabase
    .from("gear_reservation_lines")
    .select(
      "id,reservation_id,line_type,item_id,name_snapshot,quantity,unit_contribution,line_full,follow_up_answer"
    )
    .eq("reservation_id", reservationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as LineRow[];
}

/**
 * Recompute subtotal + total on a reservation from its current lines and
 * multiplier, and persist the result. Returns the new numbers so callers
 * can include them in the activity diff.
 */
async function recomputeTotals(
  supabase: Sb,
  reservationId: string,
  multiplierOverride?: number
): Promise<{ subtotal: number; total: number; multiplier: number }> {
  const [{ data: resRow }, lines] = await Promise.all([
    supabase
      .from("gear_reservations")
      .select("contribution_multiplier")
      .eq("id", reservationId)
      .maybeSingle(),
    loadLines(supabase, reservationId),
  ]);
  const multiplier =
    multiplierOverride ?? Number(resRow?.contribution_multiplier ?? 1);
  const subtotal = roundMoney(
    lines.reduce((sum, l) => sum + Number(l.line_full ?? 0), 0)
  );
  const total = roundMoney(subtotal * multiplier);
  await supabase
    .from("gear_reservations")
    .update({
      subtotal_full: subtotal,
      contribution_multiplier: multiplier,
      contribution_total: total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservationId);
  return { subtotal, total, multiplier };
}

async function maybeNotifyOrganizer(args: {
  reservation: ReservationRow;
  changes: FieldDiff[];
  notify: boolean;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string } | null> {
  if (!args.notify || args.changes.length === 0) return null;
  const lines = args.changes
    .map((c) => `• ${c.label}: ${c.before ?? "—"} → ${c.after ?? "—"}`)
    .join("\n");
  const bodyText =
    `Hi ${args.reservation.requester_name.split(" ")[0] || "there"},\n\n` +
    `We've updated your MIP gear reservation ${args.reservation.human_id}:\n\n` +
    `${lines}\n\n` +
    `If this doesn't look right, reply to this email and we'll sort it out.\n\n` +
    `— MIP Gear Library`;
  const result = await dispatchGearEmail({
    reservationId: args.reservation.id,
    humanId: args.reservation.human_id,
    toAddress: args.reservation.requester_email,
    subject: `Update to your MIP gear reservation ${args.reservation.human_id}`,
    bodyText,
    templateKey: "reservation_edited",
    actorEmail: args.actorEmail ?? null,
  });
  return { ok: result.ok, error: result.error };
}

// ─────────────── 1. Core fields ───────────────

/**
 * Update the "organizer + logistics" fields on a reservation. Any field
 * not present on the form is left unchanged. Blank strings become NULL
 * for nullable columns.
 */
export async function updateReservationCoreFields(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  const notify = formData.get("notify_organizer") === "on";
  if (!reservationId || !humanId)
    throw new Error("Missing reservation_id or human_id");

  const supabase = createAdminClient();
  const before = await loadReservation(supabase, reservationId);
  if (!before) throw new Error("Reservation not found");

  // Editable columns and their user-facing labels.
  const editable: Array<{
    field: keyof ReservationRow;
    label: string;
    nullable: boolean;
  }> = [
    { field: "requester_name", label: "Name", nullable: false },
    { field: "requester_email", label: "Email", nullable: false },
    { field: "requester_phone", label: "Phone", nullable: true },
    { field: "organization", label: "Organization", nullable: true },
    { field: "event_description", label: "Event description", nullable: true },
    { field: "pickup_location", label: "Pickup location", nullable: true },
    { field: "coupon_code", label: "Coupon", nullable: true },
    { field: "internal_notes", label: "Internal notes", nullable: true },
  ];

  const patch: Record<string, string | null> = {};
  const changes: FieldDiff[] = [];
  for (const { field, label, nullable } of editable) {
    if (!formData.has(field)) continue;
    const raw = String(formData.get(field) ?? "");
    const next = nullable ? nullIfBlank(raw) : raw.trim();
    const prev = (before[field] as string | null) ?? null;
    if (next !== prev) {
      // Guard: required fields must not become empty.
      if (!nullable && (next === null || next === "")) continue;
      patch[field] = next;
      changes.push({
        field,
        label,
        before: prev,
        after: next,
      });
    }
  }

  if (Object.keys(patch).length === 0) {
    revalidatePath(`/admin/gear/${humanId}`);
    return;
  }

  const { error } = await supabase
    .from("gear_reservations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", reservationId);
  if (error) throw new Error(`Failed to update reservation: ${error.message}`);

  const emailResult = await maybeNotifyOrganizer({
    reservation: before,
    changes: changes.filter((c) => c.field !== "internal_notes"), // never leak notes
    notify,
    actorEmail: admin.email,
  });

  await logEdit({
    supabase,
    reservationId,
    actorEmail: admin.email,
    changes,
    extra: emailResult ? { email: emailResult, notified: true } : undefined,
  });

  revalidatePath(`/admin/gear/${humanId}`);
}

// ─────────────── 2. Dates ───────────────

export async function updateReservationDates(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  const notify = formData.get("notify_organizer") === "on";
  if (!reservationId || !humanId)
    throw new Error("Missing reservation_id or human_id");

  // <input type="datetime-local"> emits "YYYY-MM-DDTHH:mm" without a
  // timezone. Interpret those as America/New_York (the org's local time)
  // by constructing a Date in the browser-neutral way: build an
  // ISO-with-offset string. We approximate ET offset off the current
  // browser date server-side is not reliable, so instead we treat the
  // string as a wall-clock time in ET and let Postgres store the
  // resulting UTC timestamp.
  const pickupRaw = String(formData.get("pickup_at") ?? "").trim();
  const returnRaw = String(formData.get("return_at") ?? "").trim();
  if (!pickupRaw || !returnRaw) throw new Error("Both dates are required");

  const pickup = parseEtWallClock(pickupRaw);
  const rtn = parseEtWallClock(returnRaw);
  if (!pickup || !rtn) throw new Error("Invalid date format");
  if (rtn.getTime() <= pickup.getTime())
    throw new Error("Return must be after pickup");

  const supabase = createAdminClient();
  const before = await loadReservation(supabase, reservationId);
  if (!before) throw new Error("Reservation not found");

  const changes: FieldDiff[] = [];
  if (pickup.toISOString() !== new Date(before.pickup_at).toISOString()) {
    changes.push({
      field: "pickup_at",
      label: "Pickup",
      before: formatDate(before.pickup_at),
      after: formatDate(pickup.toISOString()),
    });
  }
  if (rtn.toISOString() !== new Date(before.return_at).toISOString()) {
    changes.push({
      field: "return_at",
      label: "Return",
      before: formatDate(before.return_at),
      after: formatDate(rtn.toISOString()),
    });
  }
  if (changes.length === 0) {
    revalidatePath(`/admin/gear/${humanId}`);
    return;
  }

  const { error } = await supabase
    .from("gear_reservations")
    .update({
      pickup_at: pickup.toISOString(),
      return_at: rtn.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservationId);
  if (error) throw new Error(`Failed to update dates: ${error.message}`);

  const emailResult = await maybeNotifyOrganizer({
    reservation: before,
    changes,
    notify,
    actorEmail: admin.email,
  });

  await logEdit({
    supabase,
    reservationId,
    actorEmail: admin.email,
    changes,
    extra: emailResult ? { email: emailResult, notified: true } : undefined,
  });

  revalidatePath(`/admin/gear/${humanId}`);
}

/**
 * Parse a `YYYY-MM-DDTHH:mm` wall-clock string as ET (America/New_York).
 * Returns null on malformed input. Uses the fact that ET is always
 * UTC-5 in EST and UTC-4 in EDT; we compute which one is in effect on
 * the given date by asking the browser-shaped Intl API.
 */
function parseEtWallClock(input: string): Date | null {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  // Start with the naive UTC interpretation, then correct for ET offset
  // for that specific wall-clock moment.
  const naiveUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi)
  );
  // Format the same moment as ET; if ET says it's X hours off from
  // that wall clock, shift by (X * ms).
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(naiveUtc));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const etWall = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute)
  );
  const offset = naiveUtc - etWall; // ms to add to naive to get real UTC
  return new Date(naiveUtc + offset);
}

// ─────────────── 3. Tier + multiplier ───────────────

export async function updateReservationTier(formData: FormData) {
  const admin = await requireAdmin();
  const reservationId = String(formData.get("reservation_id") ?? "");
  const humanId = String(formData.get("human_id") ?? "");
  const notify = formData.get("notify_organizer") === "on";
  if (!reservationId || !humanId)
    throw new Error("Missing reservation_id or human_id");

  const tier = String(formData.get("org_tier") ?? "").trim();
  const multiplierRaw = num(String(formData.get("contribution_multiplier") ?? ""));
  if (!tier) throw new Error("Tier is required");
  if (multiplierRaw == null || multiplierRaw < 0 || multiplierRaw > 5) {
    throw new Error("Multiplier must be between 0 and 5");
  }

  const supabase = createAdminClient();
  const before = await loadReservation(supabase, reservationId);
  if (!before) throw new Error("Reservation not found");

  const changes: FieldDiff[] = [];
  if (before.org_tier !== tier) {
    changes.push({
      field: "org_tier",
      label: "Tier",
      before: before.org_tier,
      after: tier,
    });
  }
  if (Number(before.contribution_multiplier ?? 1) !== multiplierRaw) {
    changes.push({
      field: "contribution_multiplier",
      label: "Multiplier",
      before: `${before.contribution_multiplier}×`,
      after: `${multiplierRaw}×`,
    });
  }
  if (changes.length === 0) {
    revalidatePath(`/admin/gear/${humanId}`);
    return;
  }

  await supabase
    .from("gear_reservations")
    .update({ org_tier: tier, updated_at: new Date().toISOString() })
    .eq("id", reservationId);
  const { total } = await recomputeTotals(supabase, reservationId, multiplierRaw);
  changes.push({
    field: "contribution_total",
    label: "Total",
    before: formatMoney(before.contribution_total),
    after: formatMoney(total),
  });

  const emailResult = await maybeNotifyOrganizer({
    reservation: before,
    changes,
    notify,
    actorEmail: admin.email,
  });

  await logEdit({
    supabase,
    reservationId,
    actorEmail: admin.email,
    changes,
    extra: emailResult ? { email: emailResult, notified: true } : undefined,
  });

  revalidatePath(`/admin/gear/${humanId}`);
}

// ─────────────── 4. Line items ───────────────

interface LineEditResult {
  ok: true;
  changes: FieldDiff[];
}
interface LineEditFail {
  ok: false;
  error: string;
}

export async function updateReservationLine(args: {
  reservationId: string;
  humanId: string;
  lineId: string;
  quantity: number;
  unitContribution: number;
  notifyOrganizer?: boolean;
}): Promise<LineEditResult | LineEditFail> {
  const admin = await requireAdmin();
  if (args.quantity < 1) return { ok: false, error: "Quantity must be ≥ 1" };
  if (args.unitContribution < 0)
    return { ok: false, error: "Unit contribution must be ≥ 0" };

  const supabase = createAdminClient();
  const [reservation, lines] = await Promise.all([
    loadReservation(supabase, args.reservationId),
    loadLines(supabase, args.reservationId),
  ]);
  if (!reservation) return { ok: false, error: "Reservation not found" };
  const line = lines.find((l) => l.id === args.lineId);
  if (!line) return { ok: false, error: "Line not found" };

  const newFull = roundMoney(args.quantity * args.unitContribution);
  const changes: FieldDiff[] = [];
  if (line.quantity !== args.quantity) {
    changes.push({
      field: `line:${line.name_snapshot}:qty`,
      label: `${line.name_snapshot} — qty`,
      before: String(line.quantity),
      after: String(args.quantity),
    });
  }
  if (Number(line.unit_contribution) !== args.unitContribution) {
    changes.push({
      field: `line:${line.name_snapshot}:unit`,
      label: `${line.name_snapshot} — unit`,
      before: formatMoney(Number(line.unit_contribution)),
      after: formatMoney(args.unitContribution),
    });
  }
  if (changes.length === 0) return { ok: true, changes: [] };

  const { error } = await supabase
    .from("gear_reservation_lines")
    .update({
      quantity: args.quantity,
      unit_contribution: args.unitContribution,
      line_full: newFull,
    })
    .eq("id", args.lineId);
  if (error) return { ok: false, error: error.message };

  const { total } = await recomputeTotals(supabase, args.reservationId);
  changes.push({
    field: "contribution_total",
    label: "Total",
    before: formatMoney(reservation.contribution_total),
    after: formatMoney(total),
  });

  const emailResult = await maybeNotifyOrganizer({
    reservation,
    changes,
    notify: Boolean(args.notifyOrganizer),
    actorEmail: admin.email,
  });

  await logEdit({
    supabase,
    reservationId: args.reservationId,
    actorEmail: admin.email,
    changes,
    extra: emailResult ? { email: emailResult, notified: true } : undefined,
  });

  revalidatePath(`/admin/gear/${args.humanId}`);
  return { ok: true, changes };
}

export async function deleteReservationLine(args: {
  reservationId: string;
  humanId: string;
  lineId: string;
  notifyOrganizer?: boolean;
}): Promise<LineEditResult | LineEditFail> {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const [reservation, lines] = await Promise.all([
    loadReservation(supabase, args.reservationId),
    loadLines(supabase, args.reservationId),
  ]);
  if (!reservation) return { ok: false, error: "Reservation not found" };
  const line = lines.find((l) => l.id === args.lineId);
  if (!line) return { ok: false, error: "Line not found" };
  if (lines.length === 1)
    return {
      ok: false,
      error: "Can't remove the last line. Cancel the reservation instead.",
    };

  const { error } = await supabase
    .from("gear_reservation_lines")
    .delete()
    .eq("id", args.lineId);
  if (error) return { ok: false, error: error.message };

  const { total } = await recomputeTotals(supabase, args.reservationId);
  const changes: FieldDiff[] = [
    {
      field: `line:${line.name_snapshot}`,
      label: `Removed — ${line.name_snapshot}`,
      before: `${line.quantity} × ${formatMoney(Number(line.unit_contribution))}`,
      after: null,
    },
    {
      field: "contribution_total",
      label: "Total",
      before: formatMoney(reservation.contribution_total),
      after: formatMoney(total),
    },
  ];

  const emailResult = await maybeNotifyOrganizer({
    reservation,
    changes,
    notify: Boolean(args.notifyOrganizer),
    actorEmail: admin.email,
  });

  await logEdit({
    supabase,
    reservationId: args.reservationId,
    actorEmail: admin.email,
    changes,
    extra: emailResult ? { email: emailResult, notified: true } : undefined,
  });

  revalidatePath(`/admin/gear/${args.humanId}`);
  return { ok: true, changes };
}

export async function addReservationLine(args: {
  reservationId: string;
  humanId: string;
  itemId: string;
  quantity: number;
  notifyOrganizer?: boolean;
}): Promise<LineEditResult | LineEditFail> {
  const admin = await requireAdmin();
  if (args.quantity < 1) return { ok: false, error: "Quantity must be ≥ 1" };

  const supabase = createAdminClient();
  const [reservation, itemRes] = await Promise.all([
    loadReservation(supabase, args.reservationId),
    supabase
      .from("gear_items")
      .select("id, name, suggested_contribution, quantity_total, active")
      .eq("id", args.itemId)
      .maybeSingle(),
  ]);
  if (!reservation) return { ok: false, error: "Reservation not found" };
  const item = itemRes.data as
    | {
        id: string;
        name: string;
        suggested_contribution: number;
        quantity_total: number;
        active: boolean;
      }
    | null;
  if (!item || !item.active)
    return { ok: false, error: "Item is not available" };
  const qty = Math.min(args.quantity, item.quantity_total);
  const unit = Number(item.suggested_contribution ?? 0);
  const full = roundMoney(qty * unit);

  const { error } = await supabase.from("gear_reservation_lines").insert({
    reservation_id: args.reservationId,
    line_type: "item",
    item_id: item.id,
    name_snapshot: item.name,
    quantity: qty,
    unit_contribution: unit,
    line_full: full,
  });
  if (error) return { ok: false, error: error.message };

  const { total } = await recomputeTotals(supabase, args.reservationId);
  const changes: FieldDiff[] = [
    {
      field: `line:${item.name}`,
      label: `Added — ${item.name}`,
      before: null,
      after: `${qty} × ${formatMoney(unit)}`,
    },
    {
      field: "contribution_total",
      label: "Total",
      before: formatMoney(reservation.contribution_total),
      after: formatMoney(total),
    },
  ];

  const emailResult = await maybeNotifyOrganizer({
    reservation,
    changes,
    notify: Boolean(args.notifyOrganizer),
    actorEmail: admin.email,
  });

  await logEdit({
    supabase,
    reservationId: args.reservationId,
    actorEmail: admin.email,
    changes,
    extra: emailResult ? { email: emailResult, notified: true } : undefined,
  });

  revalidatePath(`/admin/gear/${args.humanId}`);
  return { ok: true, changes };
}

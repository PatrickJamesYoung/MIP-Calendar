"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sendAdminInvite } from "@/lib/email";

const INVITE_TTL_DAYS = 7;

function generateInviteToken(): string {
  // 32 random bytes = 43 chars base64url; effectively unguessable.
  return randomBytes(32).toString("base64url");
}

function absoluteAcceptUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.INGEST_API_BASE ||
    "https://app.movementinfrastructureproject.org";
  return `${base.replace(/\/$/, "")}/admin/invite/${encodeURIComponent(token)}`;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Create + email a new admin invite.
 * Any admin can invite (per user spec: single role, everyone can do everything).
 */
export async function createAdminInvite(formData: FormData) {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const emailRaw = String(formData.get("email") ?? "").trim();
  if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return { ok: false as const, error: "Please enter a valid email address." };
  }
  const email = normalizeEmail(emailRaw);

  // Reject if this email is already an admin.
  const { data: existingAdmin } = await supabase
    .from("admins")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();
  if (existingAdmin) {
    return {
      ok: false as const,
      error: `${email} is already an admin.`,
    };
  }

  // Outstanding (not accepted, not revoked) invite for this email?
  // - still valid  -> block; the Pending list has Resend/Revoke for it.
  // - expired      -> just resend it (same link, fresh 7-day expiry).
  //   Previously this blocked with "already has a pending invite" even
  //   though the invite was hidden from the Pending list, a dead end.
  const { data: existingInvite } = await supabase
    .from("admin_invites")
    .select("id, email, token, expires_at, send_count")
    .ilike("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingInvite) {
    if (new Date(existingInvite.expires_at as string).getTime() > Date.now()) {
      return {
        ok: false as const,
        error: `${email} already has a pending invite. Use Resend in the Pending invites list below.`,
      };
    }
    const r = await resendInviteRow(supabase, admin, existingInvite);
    if (!r.ok) return r;
    revalidatePath("/admin/admins");
    return { ok: true as const, email, resent: true as const };
  }

  const token = generateInviteToken();
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  const { data: inviteRow, error: insertErr } = await supabase
    .from("admin_invites")
    .insert({
      email,
      token,
      role: "admin",
      invited_by: admin.id,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !inviteRow) {
    return {
      ok: false as const,
      error: insertErr?.message ?? "Failed to create invite.",
    };
  }

  const sendResult = await sendAdminInvite({
    toEmail: email,
    acceptUrl: absoluteAcceptUrl(token),
    invitedByName: admin.display_name,
    invitedByEmail: admin.email,
    expiresAt,
  });

  if (!sendResult.ok) {
    // Roll back so the UI doesn't show a stuck invite that never went out.
    await supabase.from("admin_invites").delete().eq("id", inviteRow.id);
    return {
      ok: false as const,
      error: `Couldn't send invite email: ${sendResult.error ?? "unknown"}`,
    };
  }

  revalidatePath("/admin/admins");
  return { ok: true as const, email };
}

/**
 * Revoke a pending invite. Idempotent-ish: no-op if already accepted/revoked.
 */
export async function revokeAdminInvite(inviteId: string) {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("admin_invites")
    .update({ revoked_at: new Date().toISOString(), revoked_by: admin.id })
    .eq("id", inviteId)
    .is("accepted_at", null)
    .is("revoked_at", null);

  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/admin/admins");
  return { ok: true as const };
}

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
type Admin = Awaited<ReturnType<typeof requireAdmin>>;

/**
 * Core resend: push expiry out another INVITE_TTL_DAYS, bump send_count,
 * and re-email the SAME token. get_invite_by_token computes "expired" from
 * expires_at, so this reactivates an expired link in place.
 */
async function resendInviteRow(
  supabase: ServerSupabase,
  admin: Admin,
  invite: { id: string; email: string; token: string; send_count: number | null }
) {
  const newExpiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  const { error: updateErr } = await supabase
    .from("admin_invites")
    .update({
      expires_at: newExpiresAt.toISOString(),
      last_sent_at: new Date().toISOString(),
      send_count: (invite.send_count ?? 0) + 1,
    })
    .eq("id", invite.id);
  if (updateErr) return { ok: false as const, error: updateErr.message };

  const sendResult = await sendAdminInvite({
    toEmail: invite.email,
    acceptUrl: absoluteAcceptUrl(invite.token),
    invitedByName: admin.display_name,
    invitedByEmail: admin.email,
    expiresAt: newExpiresAt,
  });
  if (!sendResult.ok)
    return {
      ok: false as const,
      error: `Couldn't send email: ${sendResult.error ?? "unknown"}`,
    };
  return { ok: true as const };
}

/**
 * Re-send the invite email and extend expiry by another 7 days.
 * Works for both still-pending and expired invites.
 */
export async function resendAdminInvite(inviteId: string) {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const { data: invite, error: readErr } = await supabase
    .from("admin_invites")
    .select("id, email, token, accepted_at, revoked_at, send_count")
    .eq("id", inviteId)
    .maybeSingle();
  if (readErr || !invite) return { ok: false as const, error: "Invite not found." };
  if (invite.accepted_at)
    return { ok: false as const, error: "Invite already accepted." };
  if (invite.revoked_at)
    return { ok: false as const, error: "Invite was revoked." };

  const r = await resendInviteRow(supabase, admin, invite);
  if (!r.ok) return r;

  revalidatePath("/admin/admins");
  return { ok: true as const };
}

/**
 * Resend every expired, un-accepted, un-revoked invite in one go
 * (skipping anyone who has since become an admin another way).
 */
export async function resendAllExpiredInvites() {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const [{ data: invites, error }, { data: admins }] = await Promise.all([
    supabase
      .from("admin_invites")
      .select("id, email, token, send_count")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .lte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    supabase.from("admins").select("email"),
  ]);
  if (error) return { ok: false as const, error: error.message, sent: 0, failed: [] as string[] };

  const adminEmails = new Set((admins ?? []).map((a) => String(a.email).toLowerCase()));
  const seen = new Set<string>();
  let sent = 0;
  const failed: string[] = [];
  for (const inv of invites ?? []) {
    const em = String(inv.email).toLowerCase();
    if (adminEmails.has(em) || seen.has(em)) continue; // latest invite per email only
    seen.add(em);
    const r = await resendInviteRow(supabase, admin, inv);
    if (r.ok) sent++;
    else failed.push(inv.email as string);
  }

  revalidatePath("/admin/admins");
  return { ok: true as const, sent, failed };
}

/**
 * Remove an existing admin. Can't remove yourself (guard against
 * lockout) or the last remaining admin.
 */
export async function removeAdmin(adminId: string) {
  const me = await requireAdmin();
  if (adminId === me.id) {
    return { ok: false as const, error: "You can't remove yourself." };
  }
  const supabase = await createClient();

  const { count } = await supabase
    .from("admins")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) {
    return { ok: false as const, error: "Can't remove the last admin." };
  }

  const { error } = await supabase.from("admins").delete().eq("id", adminId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/admin/admins");
  return { ok: true as const };
}

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
    "https://mip-calendar.vercel.app";
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

  // Reject if there's already an outstanding invite.
  const { data: existingInvite } = await supabase
    .from("admin_invites")
    .select("id, expires_at")
    .ilike("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (existingInvite) {
    return {
      ok: false as const,
      error: `${email} already has a pending invite. Revoke or resend it instead.`,
    };
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

/**
 * Re-send the invite email and extend expiry by another 7 days.
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
    toEmail: invite.email as string,
    acceptUrl: absoluteAcceptUrl(invite.token as string),
    invitedByName: admin.display_name,
    invitedByEmail: admin.email,
    expiresAt: newExpiresAt,
  });
  if (!sendResult.ok)
    return {
      ok: false as const,
      error: `Couldn't send email: ${sendResult.error ?? "unknown"}`,
    };

  revalidatePath("/admin/admins");
  return { ok: true as const };
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

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Accept an admin invite. Requires the caller to be authenticated with the
 * email address on the invite. Creates the admins row + marks the invite
 * accepted. Idempotent-safe: if the caller is already an admin with that
 * email, we just mark the invite accepted and return ok.
 */
export async function acceptAdminInvite(token: string) {
  if (!token) return { ok: false as const, error: "Missing invite token." };
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { ok: false as const, error: "You must be signed in to accept." };

  const { data: invite, error: readErr } = await supabase
    .from("admin_invites")
    .select("id, email, role, expires_at, accepted_at, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (readErr || !invite)
    return { ok: false as const, error: "Invite not found or already used." };

  if (invite.revoked_at)
    return { ok: false as const, error: "Invite was revoked." };
  if (invite.accepted_at)
    return { ok: false as const, error: "Invite already accepted." };
  if (new Date(invite.expires_at).getTime() < Date.now())
    return { ok: false as const, error: "Invite has expired." };

  const invitedEmail = (invite.email as string).toLowerCase();
  const signedInEmail = (user.email ?? "").toLowerCase();
  if (invitedEmail !== signedInEmail) {
    return {
      ok: false as const,
      error: `This invite is for ${invite.email}, but you're signed in as ${user.email}.`,
    };
  }

  // Create the admins row (or fetch existing).
  const { data: existingAdmin } = await supabase
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  let adminId = existingAdmin?.id as string | undefined;
  if (!adminId) {
    const { data: newAdmin, error: insertErr } = await supabase
      .from("admins")
      .insert({
        user_id: user.id,
        email: user.email,
        display_name:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          null,
        role: invite.role ?? "admin",
      })
      .select("id")
      .single();
    if (insertErr || !newAdmin)
      return {
        ok: false as const,
        error: insertErr?.message ?? "Couldn't create admin record.",
      };
    adminId = newAdmin.id;
  }

  // Mark invite accepted.
  const { error: markErr } = await supabase
    .from("admin_invites")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by: adminId,
    })
    .eq("id", invite.id);
  if (markErr)
    return { ok: false as const, error: markErr.message };

  revalidatePath("/admin/admins");
  return { ok: true as const };
}

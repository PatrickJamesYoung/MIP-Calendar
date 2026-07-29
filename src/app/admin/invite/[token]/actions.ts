"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface InviteLookup {
  email: string | null;
  role: string | null;
  expires_at: string | null;
  status:
    | "not_found"
    | "revoked"
    | "accepted"
    | "expired"
    | "valid";
}

/**
 * Public token lookup. Uses the get_invite_by_token RPC (SECURITY DEFINER)
 * so anonymous callers can see the invite email + status without needing
 * broad SELECT on admin_invites.
 */
export async function lookupInvite(token: string) {
  if (!token) return { ok: false as const, error: "Missing token." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invite_by_token", {
    p_token: token,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = (data?.[0] ?? null) as InviteLookup | null;
  if (!row) return { ok: false as const, error: "Invite not found." };
  return { ok: true as const, invite: row };
}

/**
 * New-user acceptance path. Called from the accept page when the invitee
 * doesn't have a Supabase auth account yet — creates one with the given
 * password (email pre-confirmed since we vouch via the invite token),
 * then creates the admins row + marks the invite accepted. The client
 * afterwards signs in with the new credentials to establish a browser
 * session.
 */
export async function acceptInviteWithPassword(
  token: string,
  password: string,
  displayName?: string
) {
  if (!token) return { ok: false as const, error: "Missing invite token." };
  if (!password || password.length < 8)
    return {
      ok: false as const,
      error: "Password must be at least 8 characters.",
    };

  const supabase = await createClient();

  const { data: lookupData, error: lookupErr } = await supabase.rpc(
    "get_invite_by_token",
    { p_token: token }
  );
  if (lookupErr) return { ok: false as const, error: lookupErr.message };
  const invite = (lookupData?.[0] ?? null) as InviteLookup | null;
  if (!invite || invite.status === "not_found")
    return { ok: false as const, error: "Invite not found." };
  if (invite.status === "revoked")
    return { ok: false as const, error: "This invite was revoked." };
  if (invite.status === "accepted")
    return {
      ok: false as const,
      error: "This invite was already accepted.",
    };
  if (invite.status === "expired")
    return { ok: false as const, error: "This invite has expired." };
  if (!invite.email)
    return { ok: false as const, error: "Invite is missing email." };

  const email = invite.email;
  const admin = createAdminClient();

  // Check if an auth user already exists for this email. Supabase doesn't
  // expose a direct lookup, so we list users filtered by email.
  const { data: existingList, error: listErr } = await admin.auth.admin.listUsers(
    { page: 1, perPage: 1 }
  );
  // listUsers doesn't filter server-side reliably; do it client-side.
  const existingUser = existingList?.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (listErr)
    return { ok: false as const, error: listErr.message };
  if (existingUser) {
    return {
      ok: false as const,
      error:
        "An account already exists for this email. Sign in with your existing password instead.",
    };
  }

  // Create the auth user with password + email pre-confirmed.
  const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: displayName ? { full_name: displayName } : undefined,
  });
  if (createErr || !createdUser?.user)
    return {
      ok: false as const,
      error: createErr?.message ?? "Couldn't create account.",
    };

  // Look up the invite row via service role (needs the id + invited_by for
  // the admins/invite writes).
  const { data: fullInvite, error: fullErr } = await admin
    .from("admin_invites")
    .select("id, email, role, invited_by")
    .eq("token", token)
    .maybeSingle();
  if (fullErr || !fullInvite) {
    // Roll back the auth user so the invitee can retry.
    await admin.auth.admin.deleteUser(createdUser.user.id);
    return {
      ok: false as const,
      error: "Invite disappeared during signup. Try again.",
    };
  }

  // Insert admins row.
  const { data: newAdmin, error: insertErr } = await admin
    .from("admins")
    .insert({
      user_id: createdUser.user.id,
      email: createdUser.user.email,
      display_name: displayName ?? null,
      role: (fullInvite.role as string) ?? "admin",
      invited_by: fullInvite.invited_by,
    })
    .select("id")
    .single();
  if (insertErr || !newAdmin) {
    await admin.auth.admin.deleteUser(createdUser.user.id);
    return {
      ok: false as const,
      error: insertErr?.message ?? "Couldn't create admin record.",
    };
  }

  // Mark invite accepted.
  const { error: acceptErr } = await admin
    .from("admin_invites")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by: newAdmin.id,
    })
    .eq("id", fullInvite.id);
  if (acceptErr) {
    // Non-fatal: admin row is already created. Log but continue.
    console.error("Failed to mark invite accepted:", acceptErr);
  }

  revalidatePath("/admin/admins");
  return { ok: true as const, email };
}

/**
 * Existing-user acceptance path. Called when the invitee is already
 * signed in (with the correct email). Creates the admins row + marks
 * the invite accepted using the user's own session.
 */
export async function acceptInviteWithSession(token: string) {
  if (!token) return { ok: false as const, error: "Missing invite token." };
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      ok: false as const,
      error: "You must be signed in to accept.",
    };

  const { data: lookupData } = await supabase.rpc("get_invite_by_token", {
    p_token: token,
  });
  const invite = (lookupData?.[0] ?? null) as InviteLookup | null;
  if (!invite || invite.status === "not_found")
    return { ok: false as const, error: "Invite not found." };
  if (invite.status === "revoked")
    return { ok: false as const, error: "This invite was revoked." };
  if (invite.status === "accepted")
    return {
      ok: false as const,
      error: "This invite was already accepted.",
    };
  if (invite.status === "expired")
    return { ok: false as const, error: "This invite has expired." };

  const invitedEmail = (invite.email ?? "").toLowerCase();
  const signedInEmail = (user.email ?? "").toLowerCase();
  if (invitedEmail !== signedInEmail) {
    return {
      ok: false as const,
      error: `This invite is for ${invite.email}, but you're signed in as ${user.email}.`,
    };
  }

  const admin = createAdminClient();
  const { data: fullInvite, error: fullErr } = await admin
    .from("admin_invites")
    .select("id, role, invited_by")
    .eq("token", token)
    .maybeSingle();
  if (fullErr || !fullInvite)
    return { ok: false as const, error: "Invite disappeared." };

  // Check if admin row already exists.
  const { data: existingAdmin } = await admin
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  let adminId = existingAdmin?.id as string | undefined;
  if (!adminId) {
    const { data: newAdmin, error: insertErr } = await admin
      .from("admins")
      .insert({
        user_id: user.id,
        email: user.email,
        display_name:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          null,
        role: (fullInvite.role as string) ?? "admin",
        invited_by: fullInvite.invited_by,
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

  await admin
    .from("admin_invites")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by: adminId,
    })
    .eq("id", fullInvite.id);

  revalidatePath("/admin/admins");
  return { ok: true as const };
}

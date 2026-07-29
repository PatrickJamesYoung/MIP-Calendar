import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AcceptInviteButton } from "./accept-button";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by_admin: { email: string; display_name: string | null } | null;
}

export default async function AcceptInvitePage({ params }: Props) {
  const { token } = await params;
  const supabase = await createClient();

  // The RLS policy on admin_invites blocks anonymous SELECTs. We accept
  // that by making the acceptance flow require a logged-in Supabase
  // session first — the invitee lands here, is asked to sign in, and
  // AFTER they sign in the page can load the invite row (RLS grants
  // read access to any authenticated user whose auth.uid matches an
  // admins row; for pre-admin invitees, we side-step RLS via a service-
  // role lookup done inside the server action, not here).
  //
  // For the pre-signin view we render only the token stub without
  // hitting the DB. All validation happens server-side in
  // acceptInviteAction() below.

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Peek at invite metadata if we can (post-signin). This is best-effort
  // UX — the real validation is in the action.
  let invite: InviteRow | null = null;
  if (user) {
    const { data } = await supabase
      .from("admin_invites")
      .select(
        "id, email, role, expires_at, accepted_at, revoked_at, invited_by_admin:admins!admin_invites_invited_by_fkey(email, display_name)"
      )
      .eq("token", token)
      .maybeSingle();
    invite = data as unknown as InviteRow | null;
  }

  const nowMs = Date.now();
  const inviteExpired =
    invite && new Date(invite.expires_at).getTime() < nowMs;
  const inviteAccepted = invite?.accepted_at != null;
  const inviteRevoked = invite?.revoked_at != null;
  const emailMatches =
    user && invite && user.email?.toLowerCase() === invite.email.toLowerCase();

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-mip-white">
      <div
        className="w-full max-w-md border border-mip-gray-200 p-8 bg-white"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <h1
          className="mip-heading text-2xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          Admin invite
        </h1>

        {!user && (
          <>
            <p className="mt-4 text-sm text-mip-gray-700">
              You&apos;ve been invited to become an admin on the MIP Movement
              Calendar. Sign in with the email address that received this
              invite to accept.
            </p>
            <Link
              href={`/admin/login?redirectTo=${encodeURIComponent(
                `/admin/invite/${token}`
              )}`}
              className="mt-6 inline-block px-4 py-2 bg-mip-purple text-mip-white font-semibold hover:brightness-110"
              style={{ borderRadius: "var(--radius-button)" }}
            >
              Sign in to accept &rarr;
            </Link>
          </>
        )}

        {user && !invite && (
          <ErrorBlock
            title="Invite not found"
            body="This link isn't valid. It may have been revoked or mistyped. Ask the person who invited you to send a new one."
          />
        )}

        {user && invite && inviteRevoked && (
          <ErrorBlock
            title="Invite revoked"
            body="This invite was revoked. Ask an existing admin to send you a new one."
          />
        )}

        {user && invite && !inviteRevoked && inviteExpired && (
          <ErrorBlock
            title="Invite expired"
            body="This invite has expired. Ask an existing admin to resend it."
          />
        )}

        {user && invite && !inviteRevoked && !inviteExpired && inviteAccepted && (
          <SuccessBlock
            title="Already accepted"
            body="This invite has already been used. Head to the admin dashboard."
          />
        )}

        {user &&
          invite &&
          !inviteRevoked &&
          !inviteExpired &&
          !inviteAccepted &&
          !emailMatches && (
            <ErrorBlock
              title="Wrong email"
              body={`This invite is for ${invite.email}, but you're signed in as ${user.email}. Sign out and sign in with the invited email, or ask for a new invite.`}
            />
          )}

        {user &&
          invite &&
          !inviteRevoked &&
          !inviteExpired &&
          !inviteAccepted &&
          emailMatches && (
            <>
              <p className="mt-4 text-sm text-mip-gray-700">
                You&apos;re signed in as <strong>{user.email}</strong>. Accept
                this invite to gain admin access to the MIP Movement Calendar.
              </p>
              {invite.invited_by_admin && (
                <p className="mt-2 text-xs text-mip-gray-500">
                  Invited by{" "}
                  {invite.invited_by_admin.display_name ??
                    invite.invited_by_admin.email}
                </p>
              )}
              <AcceptInviteButton token={token} />
            </>
          )}
      </div>
    </div>
  );
}

function ErrorBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-red-700">{title}</p>
      <p className="mt-2 text-sm text-mip-gray-700">{body}</p>
    </div>
  );
}

function SuccessBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-green-700">{title}</p>
      <p className="mt-2 text-sm text-mip-gray-700">{body}</p>
      <Link
        href="/admin"
        className="mt-4 inline-block px-4 py-2 bg-mip-purple text-mip-white font-semibold"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        Go to admin
      </Link>
    </div>
  );
}

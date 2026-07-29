import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AcceptWithSession } from "./accept-button";
import { AcceptWithPasswordForm } from "./password-form";
import { lookupInvite } from "./actions";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function AcceptInvitePage({ params }: Props) {
  const { token } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const lookup = await lookupInvite(token);

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

        {!lookup.ok || !lookup.invite ? (
          <ErrorBlock
            title="Invite not found"
            body="This link isn't valid. Ask the person who invited you to send a new one."
          />
        ) : lookup.invite.status === "not_found" ? (
          <ErrorBlock
            title="Invite not found"
            body="This link isn't valid. Ask the person who invited you to send a new one."
          />
        ) : lookup.invite.status === "revoked" ? (
          <ErrorBlock
            title="Invite revoked"
            body="This invite was revoked. Ask an existing admin to send you a new one."
          />
        ) : lookup.invite.status === "expired" ? (
          <ErrorBlock
            title="Invite expired"
            body="This invite has expired. Ask an existing admin to resend it."
          />
        ) : lookup.invite.status === "accepted" ? (
          <SuccessBlock
            title="Already accepted"
            body="This invite has already been used. Head to the admin dashboard to sign in."
          />
        ) : user ? (
          // Signed in — verify email match, then accept via session
          (() => {
            const invitedEmail = (lookup.invite.email ?? "").toLowerCase();
            const signedInEmail = (user.email ?? "").toLowerCase();
            if (invitedEmail !== signedInEmail) {
              return (
                <ErrorBlock
                  title="Wrong email"
                  body={`This invite is for ${lookup.invite.email}, but you're signed in as ${user.email}. Sign out and sign in with the invited email.`}
                />
              );
            }
            return (
              <>
                <p className="mt-4 text-sm text-mip-gray-700">
                  You&apos;re signed in as <strong>{user.email}</strong>.
                  Accept this invite to gain admin access.
                </p>
                <AcceptWithSession token={token} />
              </>
            );
          })()
        ) : (
          // Not signed in — new user flow: create account with password
          <>
            <p className="mt-4 text-sm text-mip-gray-700">
              You&apos;ve been invited to become an admin on the MIP Movement
              Calendar. Set a password below to create your account and accept
              the invite.
            </p>
            <div className="mt-4 mb-4 text-xs text-mip-gray-500 border-l-2 border-mip-purple pl-3">
              Invited: <strong>{lookup.invite.email}</strong>
            </div>
            <AcceptWithPasswordForm
              token={token}
              email={lookup.invite.email ?? ""}
            />
            <p className="mt-4 text-xs text-mip-gray-500">
              Already have an account with this email?{" "}
              <Link
                href={`/admin/login?redirectTo=${encodeURIComponent(
                  `/admin/invite/${token}`
                )}`}
                className="underline hover:text-mip-purple"
              >
                Sign in instead
              </Link>
              .
            </p>
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

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InviteForm } from "./invite-form";
import { AdminRowActions, InviteRowActions } from "./row-actions";

export const dynamic = "force-dynamic";

interface InviteRow {
  id: string;
  email: string;
  expires_at: string;
  last_sent_at: string;
  send_count: number;
  invited_by_admin: { email: string; display_name: string | null } | null;
}

export default async function AdminsPage() {
  const me = await requireAdmin();
  const supabase = await createClient();

  const nowIso = new Date().toISOString();

  const [{ data: admins }, { data: pendingInvites }, { data: pastInvites }] =
    await Promise.all([
      supabase
        .from("admins")
        .select("id, email, display_name, role, last_active_at, created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("admin_invites")
        .select(
          "id, email, expires_at, last_sent_at, send_count, invited_by_admin:admins!admin_invites_invited_by_fkey(email, display_name)"
        )
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false }),
      supabase
        .from("admin_invites")
        .select("id, email, accepted_at, revoked_at, expires_at")
        .or(
          `accepted_at.not.is.null,revoked_at.not.is.null,expires_at.lte.${nowIso}`
        )
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const currentAdmins = admins ?? [];
  const pending = (pendingInvites ?? []) as unknown as InviteRow[];
  const isSoleAdmin = currentAdmins.length <= 1;

  return (
    <div className="space-y-8">
      <div>
        <h1
          className="mip-heading text-2xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          Admins
        </h1>
        <p className="mt-3 text-sm text-mip-gray-700">
          Invite people to help manage the calendar. Any admin can approve
          events, edit listings, and invite more admins.
        </p>
      </div>

      {/* Invite form */}
      <section>
        <h2 className="mip-heading text-lg mb-3">Invite an admin</h2>
        <InviteForm />
      </section>

      {/* Current admins */}
      <section>
        <h2 className="mip-heading text-lg mb-3">
          Current admins ({currentAdmins.length})
        </h2>
        <div
          className="border border-mip-gray-200"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          {currentAdmins.map((a, i, arr) => {
            const isMe = a.id === me.id;
            return (
              <div
                key={a.id}
                className={`flex items-center gap-3 p-3 ${
                  i < arr.length - 1 ? "border-b border-mip-gray-200" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="mip-heading text-sm truncate">
                    {a.display_name ?? a.email}
                    {isMe && (
                      <span className="ml-2 text-xs font-normal text-mip-gray-500">
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-mip-gray-500 truncate">
                    {a.email} ·{" "}
                    {a.last_active_at
                      ? `active ${new Date(
                          a.last_active_at
                        ).toLocaleDateString()}`
                      : "never active"}
                  </div>
                </div>
                <span
                  className="px-2 py-0.5 uppercase font-bold tracking-wider text-[10px]"
                  style={{
                    backgroundColor:
                      a.role === "super"
                        ? "var(--color-mip-purple)"
                        : "var(--color-mip-cyan)",
                    color:
                      a.role === "super"
                        ? "var(--color-mip-white)"
                        : "var(--color-mip-purple)",
                    borderRadius: "var(--radius-button)",
                  }}
                >
                  {a.role}
                </span>
                <AdminRowActions
                  adminId={a.id}
                  email={a.email}
                  isSelf={isMe}
                  disabled={isSoleAdmin}
                />
              </div>
            );
          })}
          {currentAdmins.length === 0 && (
            <p className="p-4 text-sm text-mip-gray-500 text-center">
              No admins yet.
            </p>
          )}
        </div>
      </section>

      {/* Pending invites */}
      <section>
        <h2 className="mip-heading text-lg mb-3">
          Pending invites ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-mip-gray-500">
            No pending invites. Invited people who accept will appear in the
            list above.
          </p>
        ) : (
          <div
            className="border border-mip-gray-200"
            style={{ borderRadius: "var(--radius-button)" }}
          >
            {pending.map((inv, i, arr) => {
              const daysLeft = Math.max(
                0,
                Math.ceil(
                  (new Date(inv.expires_at).getTime() - Date.now()) /
                    (1000 * 60 * 60 * 24)
                )
              );
              const inviter =
                inv.invited_by_admin?.display_name ??
                inv.invited_by_admin?.email ??
                "an admin";
              return (
                <div
                  key={inv.id}
                  className={`flex items-center gap-3 p-3 ${
                    i < arr.length - 1 ? "border-b border-mip-gray-200" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="mip-heading text-sm truncate">
                      {inv.email}
                    </div>
                    <div className="text-xs text-mip-gray-500 truncate">
                      Invited by {inviter} · expires in {daysLeft}{" "}
                      {daysLeft === 1 ? "day" : "days"}
                      {inv.send_count > 1 && ` · sent ${inv.send_count}×`}
                    </div>
                  </div>
                  <InviteRowActions inviteId={inv.id} email={inv.email} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent past invites - collapsed footer */}
      {(pastInvites ?? []).length > 0 && (
        <section>
          <details>
            <summary className="text-xs text-mip-gray-500 cursor-pointer hover:text-mip-purple">
              Recent completed invites ({(pastInvites ?? []).length})
            </summary>
            <div className="mt-2 border border-mip-gray-200 rounded overflow-hidden">
              {(pastInvites ?? []).map((inv, i, arr) => {
                const status = inv.accepted_at
                  ? "accepted"
                  : inv.revoked_at
                  ? "revoked"
                  : "expired";
                return (
                  <div
                    key={inv.id}
                    className={`flex items-center gap-3 p-2 text-xs ${
                      i < arr.length - 1 ? "border-b border-mip-gray-200" : ""
                    }`}
                  >
                    <span className="flex-1 truncate">{inv.email}</span>
                    <span className="text-mip-gray-500 uppercase tracking-wide">
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}

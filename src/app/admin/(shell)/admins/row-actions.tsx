"use client";

import { useTransition } from "react";
import { Trash2, Send, XCircle } from "lucide-react";
import { removeAdmin, resendAdminInvite, revokeAdminInvite } from "./team-actions";

export function AdminRowActions({
  adminId,
  email,
  isSelf,
  disabled,
}: {
  adminId: string;
  email: string;
  isSelf: boolean;
  disabled: boolean;
}) {
  const [pending, start] = useTransition();

  function handleRemove() {
    if (
      !confirm(
        `Remove admin access for ${email}? They'll lose access to /admin immediately.`
      )
    )
      return;
    start(async () => {
      const r = await removeAdmin(adminId);
      if (!r.ok) alert(`Couldn't remove: ${r.error}`);
    });
  }

  if (isSelf) return null; // never render remove button for yourself

  return (
    <button
      type="button"
      onClick={handleRemove}
      disabled={pending || disabled}
      title={disabled ? "Can't remove the last admin" : `Remove ${email}`}
      className="p-1.5 text-mip-gray-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}

export function InviteRowActions({
  inviteId,
  email,
}: {
  inviteId: string;
  email: string;
}) {
  const [pending, start] = useTransition();

  function handleResend() {
    start(async () => {
      const r = await resendAdminInvite(inviteId);
      if (!r.ok) alert(`Couldn't resend: ${r.error}`);
    });
  }

  function handleRevoke() {
    if (!confirm(`Revoke pending invite for ${email}? The link will stop working.`))
      return;
    start(async () => {
      const r = await revokeAdminInvite(inviteId);
      if (!r.ok) alert(`Couldn't revoke: ${r.error}`);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleResend}
        disabled={pending}
        title="Resend invite email + extend expiry 7 days"
        className="p-1.5 text-mip-gray-500 hover:text-mip-purple disabled:opacity-30"
      >
        <Send className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={handleRevoke}
        disabled={pending}
        title="Revoke invite"
        className="p-1.5 text-mip-gray-500 hover:text-red-600 disabled:opacity-30"
      >
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  );
}

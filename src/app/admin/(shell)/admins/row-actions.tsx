"use client";

import { useState, useTransition } from "react";
import { Trash2, Send, XCircle } from "lucide-react";
import {
  removeAdmin,
  resendAdminInvite,
  resendAllExpiredInvites,
  revokeAdminInvite,
} from "./team-actions";

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

/**
 * Expired invite row: a labelled Resend button (the primary action here,
 * so it's text, not an icon) plus a Dismiss that revokes the dead invite.
 */
export function ExpiredInviteRowActions({
  inviteId,
  email,
}: {
  inviteId: string;
  email: string;
}) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);

  function handleResend() {
    start(async () => {
      const r = await resendAdminInvite(inviteId);
      if (!r.ok) alert(`Couldn't resend: ${r.error}`);
      else setSent(true);
    });
  }

  function handleDismiss() {
    if (!confirm(`Dismiss the expired invite for ${email}?`)) return;
    start(async () => {
      const r = await revokeAdminInvite(inviteId);
      if (!r.ok) alert(`Couldn't dismiss: ${r.error}`);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleResend}
        disabled={pending || sent}
        title="Re-email the invite and extend it 7 days"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-mip-purple text-mip-white hover:brightness-110 disabled:opacity-50"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <Send className="w-3.5 h-3.5" />
        {sent ? "Sent" : pending ? "Sending…" : "Resend"}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={pending}
        title="Dismiss expired invite"
        aria-label={`Dismiss expired invite for ${email}`}
        className="p-1.5 text-mip-gray-500 hover:text-red-600 disabled:opacity-30"
      >
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ResendAllExpiredButton({ count }: { count: number }) {
  const [pending, start] = useTransition();

  function handleClick() {
    if (!confirm(`Resend all ${count} expired invites? Each gets a fresh 7-day link.`))
      return;
    start(async () => {
      const r = await resendAllExpiredInvites();
      if (!r.ok) {
        alert(`Couldn't resend: ${r.error}`);
        return;
      }
      if (r.failed.length)
        alert(`Resent ${r.sent}. Failed: ${r.failed.join(", ")}`);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-mip-purple text-mip-purple hover:bg-mip-purple hover:text-mip-white disabled:opacity-50"
      style={{ borderRadius: "var(--radius-button)" }}
    >
      <Send className="w-3.5 h-3.5" />
      {pending ? "Sending…" : `Resend all (${count})`}
    </button>
  );
}

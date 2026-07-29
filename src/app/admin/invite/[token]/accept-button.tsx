"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptAdminInvite } from "./actions";

export function AcceptInviteButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleAccept() {
    setError(null);
    start(async () => {
      const r = await acceptAdminInvite(token);
      if (r.ok) {
        router.push("/admin");
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={handleAccept}
        disabled={pending}
        className="w-full px-4 py-3 bg-mip-purple text-mip-white font-semibold disabled:opacity-50 hover:brightness-110"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        {pending ? "Accepting…" : "Accept invite & continue"}
      </button>
      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptInviteWithPassword } from "./actions";

export function AcceptWithPasswordForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    start(async () => {
      // Step 1: server creates the auth user + admin row + accepts invite
      const result = await acceptInviteWithPassword(
        token,
        password,
        displayName.trim() || undefined
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Step 2: sign the user in on this browser so cookies are set,
      // then hard-navigate to /admin so middleware sees the fresh session.
      const supabase = createClient();
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: result.email,
        password,
      });
      if (signInErr) {
        setError(
          `Account created, but auto-sign-in failed: ${signInErr.message}. Go to /admin/login and sign in.`
        );
        return;
      }
      window.location.href = "/admin";
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="email" value={email} readOnly />

      <div>
        <label className="block text-xs uppercase tracking-wide text-mip-gray-500 mb-1">
          Your name (optional)
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={pending}
          placeholder="How you want to appear in the admin"
          className="w-full px-3 py-2 border border-mip-gray-300 focus:border-mip-purple focus:outline-none text-sm disabled:opacity-50"
          style={{ borderRadius: "var(--radius-button)" }}
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-mip-gray-500 mb-1">
          Set a password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          disabled={pending}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          className="w-full px-3 py-2 border border-mip-gray-300 focus:border-mip-purple focus:outline-none text-sm disabled:opacity-50"
          style={{ borderRadius: "var(--radius-button)" }}
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-mip-gray-500 mb-1">
          Confirm password
        </label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          disabled={pending}
          autoComplete="new-password"
          className="w-full px-3 py-2 border border-mip-gray-300 focus:border-mip-purple focus:outline-none text-sm disabled:opacity-50"
          style={{ borderRadius: "var(--radius-button)" }}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full px-4 py-3 bg-mip-purple text-mip-white font-semibold disabled:opacity-50 hover:brightness-110"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        {pending ? "Creating account…" : "Create account & accept invite"}
      </button>

      {error && <p className="text-xs text-red-700">{error}</p>}
    </form>
  );
}

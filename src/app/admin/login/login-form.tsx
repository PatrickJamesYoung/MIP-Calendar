"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  redirectTo: string;
}

export function LoginForm({ redirectTo }: Props) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const supabase = createClient();

  async function handleGoogle() {
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
      },
    });
    if (error) {
      setMessage(error.message);
      setLoading(false);
    }
    // On success the browser redirects to Google, so no cleanup needed.
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }
    // Full page navigation so middleware sees the fresh cookie.
    window.location.href = redirectTo;
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleGoogle}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-mip-gray-300 hover:border-mip-purple bg-mip-white transition-colors disabled:opacity-50"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <GoogleIcon />
        <span className="mip-button-text" style={{ color: "var(--color-mip-purple)" }}>
          {loading ? "Signing in…" : "Continue with Google"}
        </span>
      </button>

      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-mip-gray-200" />
        <span className="text-xs uppercase tracking-wider text-mip-gray-500">or</span>
        <div className="flex-1 h-px bg-mip-gray-200" />
      </div>

      {!showPasswordForm ? (
        <button
          type="button"
          onClick={() => setShowPasswordForm(true)}
          className="w-full text-sm text-mip-gray-700 hover:text-mip-purple underline underline-offset-4"
        >
          Sign in with email & password
        </button>
      ) : (
        <form onSubmit={handlePassword} className="space-y-3">
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-mip-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full px-3 py-2 border border-mip-gray-300 focus:border-mip-purple outline-none text-sm"
              style={{ borderRadius: "var(--radius-button)" }}
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-mip-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 border border-mip-gray-300 focus:border-mip-purple outline-none text-sm"
              style={{ borderRadius: "var(--radius-button)" }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2.5 mip-button-text disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-mip-purple)",
              color: "var(--color-mip-white)",
              borderRadius: "var(--radius-button)",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}

      {message && (
        <p className="mt-4 text-sm text-center" style={{ color: "#c1121f" }}>
          {message}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

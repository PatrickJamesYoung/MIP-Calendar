"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { createAdminInvite } from "./team-actions";

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<
    { type: "success" | "error"; text: string } | null
  >(null);
  const [pending, start] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const fd = new FormData();
    fd.set("email", email);
    start(async () => {
      const result = await createAdminInvite(fd);
      if (result.ok) {
        setMessage({
          type: "success",
          text: `Invite emailed to ${result.email}. Link is valid for 7 days.`,
        });
        setEmail("");
      } else {
        setMessage({ type: "error", text: result.error });
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end"
    >
      <div className="flex-1">
        <label className="block text-xs uppercase tracking-wide text-mip-gray-500 mb-1">
          Email address
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={pending}
          placeholder="new-admin@example.com"
          className="w-full px-3 py-2 border border-mip-gray-300 focus:border-mip-purple focus:outline-none disabled:opacity-50 text-sm"
          style={{ borderRadius: "var(--radius-button)" }}
        />
      </div>
      <button
        type="submit"
        disabled={pending || !email}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-mip-purple text-mip-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <Mail className="w-4 h-4" />
        {pending ? "Sending…" : "Send invite"}
      </button>
      {message && (
        <p
          className={`text-xs sm:absolute sm:mt-16 ${
            message.type === "success" ? "text-green-700" : "text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}

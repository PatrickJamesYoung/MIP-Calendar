"use client";

import { useState } from "react";
import type { SpaceEmailMessage } from "./page";

/**
 * Right-column subsection that lists every email tied to this
 * space reservation. Structural mirror of the gear emails panel.
 * Plaintext body is rendered rather than HTML for the same
 * XSS-hardening reasons.
 */

interface Props {
  emails: SpaceEmailMessage[];
}

export function EmailsPanel({ emails }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (emails.length === 0) {
    return (
      <section className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Emails
        </h2>
        <p className="text-sm text-neutral-500">No emails yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Emails
        <span className="ml-2 font-normal normal-case text-neutral-400">
          ({emails.length})
        </span>
      </h2>
      <ul className="space-y-2">
        {emails.map((e) => (
          <EmailRow
            key={e.id}
            email={e}
            expanded={expandedId === e.id}
            onToggle={() =>
              setExpandedId(expandedId === e.id ? null : e.id)
            }
          />
        ))}
      </ul>
    </section>
  );
}

function EmailRow({
  email,
  expanded,
  onToggle,
}: {
  email: SpaceEmailMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isOutbound = email.direction === "outbound";
  const failed = Boolean(email.error);
  const ts = email.sent_at ?? email.received_at ?? email.created_at;
  return (
    <li
      className={`rounded-md border ${
        failed
          ? "border-rose-200 bg-rose-50"
          : isOutbound
            ? "border-neutral-200 bg-white"
            : "border-emerald-200 bg-emerald-50"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <DirectionBadge direction={email.direction} failed={failed} />
            {email.transport === "gmail" ? (
              <span className="text-neutral-500">Gmail</span>
            ) : (
              <span className="text-neutral-500">Resend</span>
            )}
            <span className="text-neutral-400">·</span>
            <span className="text-neutral-500">{formatShortDate(ts)}</span>
          </div>
          <div className="mt-1 truncate text-sm font-medium text-neutral-900">
            {email.subject || "(no subject)"}
          </div>
          <div className="mt-0.5 truncate text-xs text-neutral-500">
            {isOutbound ? (
              <>to {email.to_address}</>
            ) : (
              <>from {email.from_address}</>
            )}
            {email.template_key && (
              <>
                {" · "}
                <span className="font-mono">{email.template_key}</span>
              </>
            )}
          </div>
          {failed && (
            <div className="mt-1 text-xs text-rose-800">
              Failed: {email.error}
            </div>
          )}
        </div>
        <span className="mt-0.5 text-xs text-neutral-400">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-inherit px-3 py-3">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm text-neutral-900">
            {email.body_text || "(no body)"}
          </pre>
        </div>
      )}
    </li>
  );
}

function DirectionBadge({
  direction,
  failed,
}: {
  direction: "outbound" | "inbound";
  failed: boolean;
}) {
  const label =
    direction === "outbound" ? (failed ? "Send failed" : "Sent") : "Reply";
  const cls =
    direction === "outbound"
      ? failed
        ? "bg-rose-100 text-rose-900"
        : "bg-neutral-100 text-neutral-700"
      : "bg-emerald-100 text-emerald-900";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

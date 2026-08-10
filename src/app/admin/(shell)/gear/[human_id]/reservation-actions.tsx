"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateReservationStatus,
  prepareEmailDraft,
  sendPreparedEmail,
} from "./actions";

type Status =
  | "tentative"
  | "approved"
  | "denied"
  | "picked_up"
  | "returned"
  | "cancelled";

type TemplateKey = "submission_ack" | "approve" | "deny" | "followup";

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "tentative", label: "Tentative" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "picked_up", label: "Picked up" },
  { value: "returned", label: "Returned" },
  { value: "cancelled", label: "Cancelled" },
];

const TEMPLATE_OPTIONS: {
  value: TemplateKey;
  label: string;
  description: string;
}[] = [
  {
    value: "submission_ack",
    label: "Submission acknowledgement",
    description: "Confirms we received the request; sets expectations.",
  },
  {
    value: "approve",
    label: "Approval",
    description: "Confirms the reservation and shares pickup details.",
  },
  {
    value: "deny",
    label: "Denial",
    description: "Explains why the request can't be fulfilled.",
  },
  {
    value: "followup",
    label: "Post-event follow-up",
    description: "Sent after return — thanks the organizer, invites feedback.",
  },
];

interface Props {
  reservationId: string;
  humanId: string;
  status: Status;
  requesterEmail: string;
}

export function ReservationActions(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusValue, setStatusValue] = useState<Status>(props.status);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  function handleStatusChange(newStatus: Status) {
    if (newStatus === statusValue) return;
    const previous = statusValue;
    setStatusValue(newStatus);
    setStatusError(null);
    startTransition(async () => {
      const result = await updateReservationStatus({
        reservationId: props.reservationId,
        humanId: props.humanId,
        status: newStatus,
      });
      if (!result.ok) {
        setStatusValue(previous);
        setStatusError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Status
          </span>
          <select
            value={statusValue}
            onChange={(e) => handleStatusChange(e.target.value as Status)}
            disabled={isPending}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium shadow-sm disabled:opacity-60"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setShowEmailModal(true)}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
        >
          Send email
        </button>
      </div>

      {statusError && (
        <div className="text-xs text-rose-700">
          Status change failed: {statusError}
        </div>
      )}

      {showEmailModal && (
        <EmailComposeModal
          reservationId={props.reservationId}
          humanId={props.humanId}
          recipient={props.requesterEmail}
          onClose={() => {
            setShowEmailModal(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─────────── Modal: pick template → preview → edit → send ───────────

interface ModalProps {
  reservationId: string;
  humanId: string;
  recipient: string;
  onClose: () => void;
}

type ModalStage =
  | { kind: "pick" }
  | { kind: "loading"; template: TemplateKey }
  | {
      kind: "edit";
      template: TemplateKey;
      subject: string;
      bodyText: string;
      reason?: string;
    }
  | { kind: "sending"; template: TemplateKey }
  | { kind: "sent"; template: TemplateKey; subject: string }
  | { kind: "error"; template: TemplateKey; message: string };

function EmailComposeModal({
  reservationId,
  humanId,
  recipient,
  onClose,
}: ModalProps) {
  const [stage, setStage] = useState<ModalStage>({ kind: "pick" });
  const [selectedTemplate, setSelectedTemplate] =
    useState<TemplateKey>("submission_ack");
  const [denyReason, setDenyReason] = useState("");

  async function loadDraft(template: TemplateKey, reason?: string) {
    setStage({ kind: "loading", template });
    const extra = template === "deny" && reason ? { reason } : undefined;
    const result = await prepareEmailDraft({
      reservationId,
      templateKey: template,
      extraPlaceholders: extra,
    });
    if (!result.ok) {
      setStage({ kind: "error", template, message: result.error });
      return;
    }
    setStage({
      kind: "edit",
      template,
      subject: result.subject,
      bodyText: result.bodyText,
      reason,
    });
  }

  async function handleSend() {
    if (stage.kind !== "edit") return;
    const { template, subject, bodyText } = stage;
    setStage({ kind: "sending", template });
    const result = await sendPreparedEmail({
      reservationId,
      humanId,
      templateKey: template,
      subject,
      bodyText,
    });
    if (!result.ok) {
      setStage({ kind: "error", template, message: result.error });
      return;
    }
    setStage({
      kind: "sent",
      template,
      subject: result.subject,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold">Send email</h3>
            <p className="text-xs text-neutral-500">
              Recipient: <span className="font-mono">{recipient}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {stage.kind === "pick" && (
            <div>
              <p className="mb-3 text-sm text-neutral-600">
                Pick a template. You'll see the draft before it sends and can
                edit anything.
              </p>
              <div className="space-y-2">
                {TEMPLATE_OPTIONS.map((t) => (
                  <label
                    key={t.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm ${
                      selectedTemplate === t.value
                        ? "border-neutral-900 bg-neutral-50"
                        : "border-neutral-200 bg-white hover:bg-neutral-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={t.value}
                      checked={selectedTemplate === t.value}
                      onChange={() => setSelectedTemplate(t.value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-medium text-neutral-900">
                        {t.label}
                      </span>
                      <span className="block text-xs text-neutral-500">
                        {t.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {selectedTemplate === "deny" && (
                <div className="mt-4">
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                      Reason (optional — inserted into the draft)
                    </span>
                    <textarea
                      value={denyReason}
                      onChange={(e) => setDenyReason(e.target.value)}
                      rows={3}
                      placeholder="e.g. Gear is already committed that weekend."
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {stage.kind === "loading" && (
            <div className="py-16 text-center text-sm text-neutral-500">
              Preparing draft…
            </div>
          )}

          {stage.kind === "edit" && (
            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Subject
                  </label>
                  <span className="text-xs text-neutral-400">
                    Template:{" "}
                    {TEMPLATE_OPTIONS.find((t) => t.value === stage.template)
                      ?.label ?? stage.template}
                  </span>
                </div>
                <input
                  type="text"
                  value={stage.subject}
                  onChange={(e) =>
                    setStage({ ...stage, subject: e.target.value })
                  }
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Body
                </label>
                <textarea
                  value={stage.bodyText}
                  onChange={(e) =>
                    setStage({ ...stage, bodyText: e.target.value })
                  }
                  rows={16}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs leading-relaxed"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Plain text. Blank lines become paragraph breaks; URLs auto-link.
                </p>
              </div>
            </div>
          )}

          {stage.kind === "sending" && (
            <div className="py-16 text-center text-sm text-neutral-500">
              Sending…
            </div>
          )}

          {stage.kind === "sent" && (
            <div className="py-8 text-center">
              <div className="mb-3 text-3xl">✓</div>
              <p className="text-sm font-medium text-emerald-900">
                Email sent to {recipient}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Subject: {stage.subject}
              </p>
            </div>
          )}

          {stage.kind === "error" && (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
              <div className="font-medium">Something went wrong</div>
              <p className="mt-1">{stage.message}</p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-5 py-3">
          {stage.kind === "pick" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  loadDraft(
                    selectedTemplate,
                    selectedTemplate === "deny" ? denyReason : undefined
                  )
                }
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Preview draft
              </button>
            </>
          )}

          {stage.kind === "edit" && (
            <>
              <button
                type="button"
                onClick={() => setStage({ kind: "pick" })}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSend}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Send to {recipient}
              </button>
            </>
          )}

          {(stage.kind === "sent" || stage.kind === "error") && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Close
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

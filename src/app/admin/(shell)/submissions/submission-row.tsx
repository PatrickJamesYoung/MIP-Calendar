"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  Check,
  X,
  Loader2,
  Mail,
  Phone,
  ExternalLink,
  Calendar,
  MapPin,
  Info,
} from "lucide-react";
import {
  approveSubmissionAction,
  rejectSubmissionAction,
} from "./actions";

interface Submission {
  id: string;
  submitter_name: string;
  submitter_email: string;
  submitter_phone: string | null;
  event_payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  admin_notes: string | null;
  decided_at: string | null;
  published_event_id: string | null;
  created_at: string;
}

interface Props {
  submission: Submission;
  overlayName: string | null;
  eventTypeName: string | null;
}

export function SubmissionRow({ submission, overlayName, eventTypeName }: Props) {
  const [expanded, setExpanded] = useState(submission.status === "pending");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const p = submission.event_payload as {
    title?: string;
    description?: string | null;
    starts_at?: string;
    ends_at?: string | null;
    all_day?: boolean;
    location_text?: string | null;
    location_type?: string | null;
    cost?: string | null;
    host_org?: string | null;
    web_link?: string | null;
    image_url?: string | null;
    accessibility?: string[];
  };

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const r = await approveSubmissionAction(submission.id);
      if (!r.ok) setError(r.error);
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const r = await rejectSubmissionAction(submission.id, reason);
      if (r.ok) {
        setRejecting(false);
        setReason("");
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div
      className="border border-mip-gray-200 bg-mip-white"
      style={{ borderRadius: "var(--radius-button)" }}
    >
      {/* Header row */}
      <div className="p-4 flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-semibold text-mip-gray-900">
              {p.title || "(untitled)"}
            </h3>
            <StatusBadge status={submission.status} />
          </div>
          <p className="text-xs text-mip-gray-500 mt-1">
            Submitted by <strong>{submission.submitter_name}</strong> ·{" "}
            {new Date(submission.created_at).toLocaleString()}
          </p>
        </div>

        {submission.status === "pending" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-sm px-3 py-1.5 border border-mip-gray-300 hover:border-mip-purple mip-button-text"
              style={{ borderRadius: "var(--radius-button)" }}
            >
              {expanded ? "Collapse" : "Review"}
            </button>
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 mip-button-text disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-mip-yellow)",
                color: "var(--color-mip-purple)",
                borderRadius: "var(--radius-button)",
              }}
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Approve
            </button>
            <button
              onClick={() => setRejecting(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-50 mip-button-text disabled:opacity-50"
              style={{ borderRadius: "var(--radius-button)" }}
            >
              <X className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        )}
        {submission.status === "approved" && submission.published_event_id && (
          <Link
            href={`/admin/events/${submission.published_event_id}/edit`}
            className="text-sm text-mip-purple underline underline-offset-4"
          >
            View published event
          </Link>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-3 p-2 text-sm bg-red-50 border border-red-200 text-red-800 rounded">
          {error}
        </div>
      )}

      {/* Reject reason form */}
      {rejecting && (
        <div className="mx-4 mb-4 p-4 bg-red-50 border border-red-200 rounded space-y-3">
          <label className="mip-input-label block">
            Reason (will be sent to the submitter)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Duplicate of an existing event; missing required info; outside DC region…"
            className="mip-input"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleReject}
              disabled={isPending || reason.trim().length < 5}
              className="text-sm px-3 py-1.5 bg-red-600 text-white disabled:opacity-50 mip-button-text"
              style={{ borderRadius: "var(--radius-button)" }}
            >
              {isPending ? "Rejecting…" : "Confirm rejection"}
            </button>
            <button
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
              className="text-sm px-3 py-1.5 border border-mip-gray-300 mip-button-text"
              style={{ borderRadius: "var(--radius-button)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rejection reason display */}
      {submission.status === "rejected" && submission.admin_notes && (
        <div className="mx-4 mb-4 p-3 bg-red-50 border-l-2 border-red-400 text-sm">
          <div className="text-xs uppercase tracking-wider font-semibold text-red-700 mb-1">
            Rejection reason
          </div>
          <div className="text-mip-gray-900 whitespace-pre-wrap">
            {submission.admin_notes}
          </div>
        </div>
      )}

      {/* Details */}
      {expanded && (
        <div className="border-t border-mip-gray-200 p-4 grid md:grid-cols-2 gap-6 text-sm">
          <div className="space-y-3">
            <DetailBlock icon={Calendar} label="When">
              {p.starts_at ? (
                <>
                  {new Date(p.starts_at).toLocaleString(undefined, {
                    timeZone: "America/New_York",
                    dateStyle: "medium",
                    timeStyle: p.all_day ? undefined : "short",
                  })}
                  {p.ends_at &&
                    ` – ${new Date(p.ends_at).toLocaleString(undefined, {
                      timeZone: "America/New_York",
                      dateStyle: "medium",
                      timeStyle: p.all_day ? undefined : "short",
                    })}`}
                  {p.all_day && " (all-day)"}
                </>
              ) : (
                <em className="text-mip-gray-500">not provided</em>
              )}
            </DetailBlock>
            <DetailBlock icon={MapPin} label="Location">
              {p.location_text ? (
                <>
                  {p.location_text}
                  {p.location_type && (
                    <span className="ml-2 text-xs text-mip-gray-500">
                      ({p.location_type.replace("_", " ")})
                    </span>
                  )}
                </>
              ) : (
                <em className="text-mip-gray-500">not provided</em>
              )}
            </DetailBlock>
            <DetailBlock icon={Info} label="Categorization">
              <div>{overlayName ?? <em className="text-mip-gray-500">no overlay</em>}</div>
              {eventTypeName && (
                <div className="text-xs text-mip-gray-500">{eventTypeName}</div>
              )}
            </DetailBlock>
            {p.description && (
              <div>
                <div className="text-xs uppercase tracking-wider font-semibold text-mip-gray-500 mb-1">
                  Description
                </div>
                <div
                  className="text-sm text-mip-gray-900 max-h-40 overflow-y-auto pr-2 whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: p.description }}
                />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <DetailBlock icon={Mail} label="Submitter">
              <div>{submission.submitter_name}</div>
              <a
                href={`mailto:${submission.submitter_email}`}
                className="text-mip-purple underline underline-offset-4"
              >
                {submission.submitter_email}
              </a>
              {submission.submitter_phone && (
                <div className="flex items-center gap-1 mt-0.5 text-xs">
                  <Phone className="w-3 h-3" /> {submission.submitter_phone}
                </div>
              )}
            </DetailBlock>

            {p.host_org && (
              <DetailBlock icon={Info} label="Host">
                {p.host_org}
              </DetailBlock>
            )}
            {p.cost && (
              <DetailBlock icon={Info} label="Cost">
                {p.cost}
              </DetailBlock>
            )}
            {p.web_link && (
              <DetailBlock icon={ExternalLink} label="RSVP / link">
                <a
                  href={p.web_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-mip-purple underline underline-offset-4 break-all"
                >
                  {p.web_link}
                </a>
              </DetailBlock>
            )}
            {p.image_url && (
              <div>
                <div className="text-xs uppercase tracking-wider font-semibold text-mip-gray-500 mb-1">
                  Image
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.image_url}
                  alt=""
                  className="max-h-32 rounded border border-mip-gray-200"
                />
              </div>
            )}
            {p.accessibility && p.accessibility.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider font-semibold text-mip-gray-500 mb-1">
                  Accessibility
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.accessibility.map((a) => (
                    <span
                      key={a}
                      className="text-xs px-2 py-0.5"
                      style={{
                        backgroundColor: "var(--color-mip-cyan)",
                        color: "var(--color-mip-purple)",
                        borderRadius: "var(--radius-button)",
                      }}
                    >
                      {a.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "pending" | "approved" | "rejected" }) {
  const map = {
    pending: {
      label: "Pending",
      bg: "var(--color-mip-yellow)",
      fg: "var(--color-mip-purple)",
    },
    approved: {
      label: "Approved",
      bg: "#065f46",
      fg: "#ffffff",
    },
    rejected: {
      label: "Rejected",
      bg: "#991b1b",
      fg: "#ffffff",
    },
  };
  const cfg = map[status];
  return (
    <span
      className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5"
      style={{
        backgroundColor: cfg.bg,
        color: cfg.fg,
        borderRadius: "var(--radius-button)",
      }}
    >
      {cfg.label}
    </span>
  );
}

function DetailBlock({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-mip-gray-500" />
      <div>
        <div className="text-xs uppercase tracking-wider font-semibold text-mip-gray-500 mb-0.5">
          {label}
        </div>
        <div className="text-mip-gray-900">{children}</div>
      </div>
    </div>
  );
}

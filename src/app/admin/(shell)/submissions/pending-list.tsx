"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { SubmissionRow } from "./submission-row";
import { approveSubmissionsAction } from "./actions";

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
  source_type?: string | null;
  source_name?: string | null;
  source_external_id?: string | null;
  source_url?: string | null;
  auto_submit?: boolean | null;
}

interface Props {
  submissions: Submission[];
  overlayById: Record<string, string>;
  eventTypeById: Record<string, string>;
}

/**
 * Client wrapper that adds bulk-select + bulk-approve to a list of
 * submissions. Selection checkboxes only appear on pending rows; approved
 * and rejected rows render as read-only via the existing SubmissionRow.
 */
export function PendingList({ submissions, overlayById, eventTypeById }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | null
    | {
        approved: number;
        failed: { id: string; error: string; title: string }[];
      }
  >(null);

  const pendingSubmissions = submissions.filter((s) => s.status === "pending");
  const pendingIds = pendingSubmissions.map((s) => s.id);
  const allSelected =
    pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggle(id: string) {
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllPending() {
    setResult(null);
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingIds));
    }
  }

  function clearSelection() {
    setSelected(new Set());
    setResult(null);
  }

  function handleBulkApprove() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setResult(null);
    startTransition(async () => {
      const r = await approveSubmissionsAction(ids);
      // Enrich failures with a title lookup so the toast is useful
      const failed = r.failed.map((f) => {
        const sub = submissions.find((s) => s.id === f.id);
        const title =
          (sub?.event_payload as { title?: string })?.title ?? "(untitled)";
        return { ...f, title };
      });
      setResult({ approved: r.approved.length, failed });
      // Clear selection for the ones that succeeded; keep failures selected
      // so the user can see which rows still need attention.
      const failedIds = new Set(failed.map((f) => f.id));
      setSelected(new Set(Array.from(selected).filter((id) => failedIds.has(id))));
    });
  }

  return (
    <>
      {/* Bulk actions bar — appears when 1+ pending submissions are selected */}
      {someSelected && (
        <div
          className="sticky top-2 z-20 mt-4 flex items-center gap-3 flex-wrap p-3 bg-mip-purple text-mip-white shadow-lg"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          <span className="font-semibold">
            {selected.size} selected
          </span>
          <div className="flex-1" />
          <button
            onClick={handleBulkApprove}
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
            Approve {selected.size} selected
          </button>
          <button
            onClick={clearSelection}
            disabled={isPending}
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 border border-white/30 hover:bg-white/10 mip-button-text disabled:opacity-50"
            style={{ borderRadius: "var(--radius-button)" }}
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      )}

      {/* Bulk result toast */}
      {result && (
        <div
          className={`mt-4 p-3 text-sm ${
            result.failed.length === 0
              ? "bg-green-50 border border-green-200 text-green-900"
              : "bg-amber-50 border border-amber-200 text-amber-900"
          }`}
          style={{ borderRadius: "var(--radius-button)" }}
        >
          <div className="font-semibold">
            Approved {result.approved} submission
            {result.approved === 1 ? "" : "s"}.
            {result.failed.length > 0 && (
              <> {result.failed.length} could not be approved:</>
            )}
          </div>
          {result.failed.length > 0 && (
            <ul className="mt-1 list-disc list-inside">
              {result.failed.map((f) => (
                <li key={f.id}>
                  <strong>{f.title}</strong>: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* "Select all pending" checkbox — only shown when the filter includes
          at least one pending submission */}
      {pendingIds.length > 0 && (
        <div className="mt-6 flex items-center gap-2 text-sm text-mip-gray-700">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={selectAllPending}
              className="w-4 h-4 accent-mip-purple cursor-pointer"
            />
            <span>
              {allSelected
                ? `Deselect all ${pendingIds.length} pending`
                : `Select all ${pendingIds.length} pending`}
            </span>
          </label>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {submissions.map((sub) => (
          <SubmissionRow
            key={sub.id}
            submission={sub}
            overlayName={
              overlayById[
                (sub.event_payload.overlay_calendar_id as string | null) ?? ""
              ] ?? null
            }
            eventTypeName={
              eventTypeById[
                (sub.event_payload.event_type_id as string | null) ?? ""
              ] ?? null
            }
            selected={selected.has(sub.id)}
            onToggleSelect={
              sub.status === "pending" ? () => toggle(sub.id) : undefined
            }
          />
        ))}
      </div>
    </>
  );
}

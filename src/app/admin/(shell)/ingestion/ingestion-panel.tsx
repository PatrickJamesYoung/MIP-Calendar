"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, Database, Download, Loader2, RefreshCw } from "lucide-react";
import { backfillHistoryAction } from "./actions";

type Run = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  fetched_count: number;
  new_count: number;
  submitted_count: number;
  skipped_count: number;
  auto_submit_count: number;
  by_source: Record<string, { fetched: number; submitted: number; auto_submit: number; skipped: number; errors: number }> | null;
  error_message: string | null;
  triggered_by: string | null;
  runner_version: string | null;
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function durationLabel(startedAt: string, finishedAt: string | null): string {
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const s = Math.round((end - new Date(startedAt).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function IngestionPanel({ runs, historyCount }: { runs: Run[]; historyCount: number }) {
  const [backfillResult, setBackfillResult] = useState<
    | { imported: number; skipped: number; total: number }
    | { error: string }
    | null
  >(null);
  const [isBackfilling, startBackfill] = useTransition();

  function handleBackfill() {
    if (!confirm(`Load the 873-event historical baseline into ingestion_history? This is a one-time setup and is idempotent.`)) {
      return;
    }
    setBackfillResult(null);
    startBackfill(async () => {
      const r = await backfillHistoryAction();
      if (r.ok) setBackfillResult({ imported: r.imported, skipped: r.skipped, total: r.total });
      else setBackfillResult({ error: r.error });
    });
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="mip-h2" style={{ color: "var(--color-mip-purple)" }}>
          Ingestion
        </h1>
        <p className="mt-2 text-sm text-mip-gray-700 max-w-2xl">
          The DC events runner scrapes {" "}
          <code className="text-xs bg-mip-gray-100 px-1">Free DC, Grassroots DC, Rhizome DC, Mobilize, Festival Center, PopVille, Busboys &amp; Poets</code>{" "}
          twice a week (Sun / Thu 8pm ET) via GitHub Actions and posts new events into the {" "}
          <Link href="/admin/submissions" className="underline">submissions queue</Link> with the Movement Calendar overlay locked in.
        </p>
      </div>

      {/* Historical baseline card */}
      <section
        className="border border-mip-gray-200 p-5"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="mip-nav-text mb-1 flex items-center gap-2" style={{ color: "var(--color-mip-purple)" }}>
              <Database className="w-4 h-4" /> Historical baseline
            </h2>
            <p className="text-sm text-mip-gray-700 max-w-xl">
              873 events ingested by the old Google-Sheets pipeline (May–July 2026). Loaded once
              to seed the dedup set so bi-weekly runs don&apos;t re-submit events humans already
              saw in the old workflow.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold" style={{ color: "var(--color-mip-purple)" }}>
              {historyCount.toLocaleString()}
            </div>
            <div className="text-xs text-mip-gray-600">rows in ingestion_history</div>
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={handleBackfill}
            disabled={isBackfilling}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-mip-purple text-mip-purple hover:bg-mip-purple hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderRadius: "var(--radius-button)" }}
          >
            {isBackfilling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                {historyCount === 0 ? "Load historical baseline" : "Re-run backfill (idempotent)"}
              </>
            )}
          </button>
        </div>

        {backfillResult && "error" in backfillResult && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2" style={{ borderRadius: "var(--radius-button)" }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Backfill failed</div>
              <div className="text-xs mt-1 font-mono">{backfillResult.error}</div>
            </div>
          </div>
        )}
        {backfillResult && "imported" in backfillResult && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 text-sm text-green-800 flex items-start gap-2" style={{ borderRadius: "var(--radius-button)" }}>
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              Imported <strong>{backfillResult.imported}</strong> rows, skipped <strong>{backfillResult.skipped}</strong> {" "}
              (already present or invalid). Total processed: <strong>{backfillResult.total}</strong>.
            </div>
          </div>
        )}
      </section>

      {/* Runs */}
      <section
        className="border border-mip-gray-200 p-5"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="mip-nav-text flex items-center gap-2" style={{ color: "var(--color-mip-purple)" }}>
            <RefreshCw className="w-4 h-4" /> Recent runs
          </h2>
          <span className="text-xs text-mip-gray-600">
            {runs.length === 0 ? "no runs yet" : `showing ${runs.length} most recent`}
          </span>
        </div>

        {runs.length === 0 ? (
          <div className="p-8 text-center text-sm text-mip-gray-600 border border-dashed border-mip-gray-200" style={{ borderRadius: "var(--radius-button)" }}>
            <Clock className="w-6 h-6 mx-auto mb-2 opacity-60" />
            Runs will appear here after the first GitHub Actions execution.
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map((r) => (
              <div key={r.id} className="p-4 border border-mip-gray-200 bg-white" style={{ borderRadius: "var(--radius-button)" }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      {r.status === "success" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                      {r.status === "failed" && <AlertCircle className="w-4 h-4 text-red-600" />}
                      {r.status === "running" && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
                      <span className="text-sm font-medium capitalize">{r.status}</span>
                      <span className="text-xs text-mip-gray-500">
                        · {relativeTime(r.started_at)} · {durationLabel(r.started_at, r.finished_at)}
                      </span>
                    </div>
                    <div className="text-xs text-mip-gray-500 mt-1">
                      {r.triggered_by ?? "unknown"} {r.runner_version && `· ${r.runner_version}`}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-center text-xs">
                    <Stat label="fetched" value={r.fetched_count} />
                    <Stat label="submitted" value={r.submitted_count} highlight />
                    <Stat label="auto-flagged" value={r.auto_submit_count} />
                    <Stat label="skipped" value={r.skipped_count} />
                  </div>
                </div>

                {r.by_source && Object.keys(r.by_source).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-mip-gray-100">
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
                      {Object.entries(r.by_source).map(([source, counts]) => (
                        <div key={source} className="p-2 bg-mip-gray-50" style={{ borderRadius: "6px" }}>
                          <div className="font-medium truncate" title={source}>{source}</div>
                          <div className="text-mip-gray-600 mt-0.5">
                            {counts.fetched} → {counts.submitted}
                            {counts.errors > 0 && <span className="text-red-600"> · {counts.errors}!</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {r.error_message && (
                  <div className="mt-3 p-2 bg-red-50 border border-red-200 text-xs text-red-800 font-mono">
                    {r.error_message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <div className={`text-lg font-semibold ${highlight ? "text-mip-purple" : ""}`} style={highlight ? { color: "var(--color-mip-purple)" } : undefined}>
        {value.toLocaleString()}
      </div>
      <div className="text-mip-gray-600">{label}</div>
    </div>
  );
}

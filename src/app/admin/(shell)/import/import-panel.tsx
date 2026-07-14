"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import {
  previewTrumbaImportAction,
  runTrumbaImportAction,
  type ImportPreview,
} from "./actions";

type RunResult = {
  created: number;
  updated: number;
  skipped_unmatched_category: string[];
  skipped_errors: Array<{ title: string; error: string }>;
} | null;

export function ImportPanel() {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResult>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isPreviewing, startPreview] = useTransition();
  const [isRunning, startRun] = useTransition();

  function handlePreview() {
    setPreviewError(null);
    setRunResult(null);
    setRunError(null);
    startPreview(async () => {
      const result = await previewTrumbaImportAction();
      if (result.ok) setPreview(result.preview);
      else setPreviewError(result.error);
    });
  }

  function handleRun() {
    if (!preview) return;
    if (
      !confirm(
        `Import ${preview.total_upcoming} upcoming events? ` +
          `(${preview.will_create} new, ${preview.will_update} updates)`
      )
    ) {
      return;
    }
    setRunError(null);
    startRun(async () => {
      const result = await runTrumbaImportAction();
      if (result.ok) {
        setRunResult({
          created: result.created,
          updated: result.updated,
          skipped_unmatched_category: result.skipped_unmatched_category,
          skipped_errors: result.skipped_errors,
        });
        // Refresh preview so counts show 0 to create next time
        const p = await previewTrumbaImportAction();
        if (p.ok) setPreview(p.preview);
      } else {
        setRunError(result.error);
      }
    });
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Step 1: Preview */}
      <section
        className="border border-mip-gray-200 p-5"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="mip-nav-text mb-1" style={{ color: "var(--color-mip-purple)" }}>
              Step 1 — Preview
            </h2>
            <p className="text-sm text-mip-gray-700">
              Fetch the Trumba feed and see what would change. Nothing is written.
            </p>
          </div>
          <button
            onClick={handlePreview}
            disabled={isPreviewing}
            className="inline-flex items-center gap-2 px-4 py-2 mip-button-text disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-mip-purple)",
              color: "var(--color-mip-white)",
              borderRadius: "var(--radius-button)",
            }}
          >
            {isPreviewing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {preview ? "Refresh preview" : "Fetch feed"}
          </button>
        </div>

        {previewError && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 p-3 rounded">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{previewError}</div>
          </div>
        )}

        {preview && <PreviewSummary preview={preview} />}
      </section>

      {/* Step 2: Run */}
      {preview && (
        <section
          className="border border-mip-gray-200 p-5"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2
                className="mip-nav-text mb-1"
                style={{ color: "var(--color-mip-purple)" }}
              >
                Step 2 — Run import
              </h2>
              <p className="text-sm text-mip-gray-700">
                Idempotent — re-running updates matched events in place. Only
                published, upcoming events are touched.
              </p>
            </div>
            <button
              onClick={handleRun}
              disabled={isRunning || preview.total_upcoming === 0}
              className="inline-flex items-center gap-2 px-4 py-2 mip-button-text disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-mip-yellow)",
                color: "var(--color-mip-purple)",
                borderRadius: "var(--radius-button)",
              }}
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Import {preview.total_upcoming} events
            </button>
          </div>

          {runError && (
            <div className="mt-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 p-3 rounded">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>{runError}</div>
            </div>
          )}

          {runResult && <RunResultSummary result={runResult} />}
        </section>
      )}
    </div>
  );
}

function PreviewSummary({ preview }: { preview: ImportPreview }) {
  return (
    <div className="mt-5 space-y-5">
      {/* Counts */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Upcoming events" value={preview.total_upcoming} />
        <StatCard label="Will create" value={preview.will_create} accent="mip-yellow" />
        <StatCard label="Will update" value={preview.will_update} accent="mip-cyan" />
      </div>

      {/* Categories */}
      <div>
        <h3 className="text-xs uppercase tracking-wider font-semibold text-mip-gray-500 mb-2">
          By overlay calendar (category)
        </h3>
        <ul className="text-sm space-y-1">
          {preview.by_category.map((c) => (
            <li key={c.category} className="flex items-center gap-2">
              <span className="w-8 text-right text-mip-gray-500 tabular-nums">
                {c.count}
              </span>
              <span>{c.category}</span>
              {!c.overlay_matched && c.category !== "(no category)" && (
                <span className="text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                  no matching overlay
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Event types */}
      <div>
        <h3 className="text-xs uppercase tracking-wider font-semibold text-mip-gray-500 mb-2">
          By event type
        </h3>
        <ul className="text-sm space-y-1">
          {preview.by_event_type.map((t) => (
            <li key={t.event_type} className="flex items-center gap-2">
              <span className="w-8 text-right text-mip-gray-500 tabular-nums">
                {t.count}
              </span>
              <span>{t.event_type}</span>
              {!t.matched && (
                <span className="text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                  no matching type
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Samples */}
      <details className="text-sm">
        <summary className="cursor-pointer text-mip-purple font-semibold">
          Show 5 sample parsed events
        </summary>
        <pre className="mt-2 bg-mip-gray-50 border border-mip-gray-200 p-3 rounded text-xs overflow-x-auto max-h-96">
          {JSON.stringify(preview.samples, null, 2)}
        </pre>
      </details>

      <p className="text-xs text-mip-gray-500">
        Fetched {new Date(preview.fetched_at).toLocaleString()}
      </p>
    </div>
  );
}

function RunResultSummary({ result }: { result: NonNullable<RunResult> }) {
  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-start gap-2 text-sm bg-green-50 border border-green-200 text-green-800 p-3 rounded">
        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          Import complete. <strong>{result.created} created</strong>,{" "}
          <strong>{result.updated} updated</strong>.
        </div>
      </div>

      {result.skipped_unmatched_category.length > 0 && (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded">
          <div className="font-semibold mb-1">
            Categories with no matching overlay:
          </div>
          <ul className="list-disc list-inside">
            {result.skipped_unmatched_category.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-1 text-xs">
            Events were still imported but their overlay is unset. Create the
            overlay under Calendars, then re-run to link them.
          </div>
        </div>
      )}

      {result.skipped_errors.length > 0 && (
        <div className="text-sm bg-red-50 border border-red-200 text-red-800 p-3 rounded">
          <div className="font-semibold mb-1">
            {result.skipped_errors.length} events failed:
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {result.skipped_errors.slice(0, 10).map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.title}</span> — {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "mip-yellow" | "mip-cyan";
}) {
  const accentColor =
    accent === "mip-yellow"
      ? "var(--color-mip-yellow)"
      : accent === "mip-cyan"
        ? "var(--color-mip-cyan)"
        : "var(--color-mip-gray-100)";
  return (
    <div
      className="p-4 border border-mip-gray-200"
      style={{ borderRadius: "var(--radius-button)" }}
    >
      <div className="text-3xl font-bold" style={{ color: "var(--color-mip-purple)" }}>
        {value.toLocaleString()}
      </div>
      <div
        className="mt-1 h-1 w-8"
        style={{ backgroundColor: accentColor }}
      />
      <div className="mt-2 text-xs uppercase tracking-wider text-mip-gray-500 font-semibold">
        {label}
      </div>
    </div>
  );
}

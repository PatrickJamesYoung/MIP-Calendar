import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Per-run daybook preview. Renders the persisted draft's HTML in an
 * isolated iframe (via srcDoc) and shows subject, validation report,
 * and per-source fetch outcomes side-by-side.
 *
 * The iframe is sandboxed with no `allow-scripts`, so the draft can't
 * execute anything even if the composer somehow smuggled a script in.
 */
export default async function DaybookRunPreview({
  params,
}: {
  params: Promise<{ run_id: string }>;
}) {
  await requireAdmin();
  const { run_id } = await params;
  const supabase = createAdminClient();

  const [runRes, draftRes, sourcesRes, sendRes] = await Promise.all([
    supabase
      .from("daybook_runs")
      .select(
        "id, publication_date, edition, status, started_at, finished_at, error, github_run_url",
      )
      .eq("id", run_id)
      .maybeSingle(),
    supabase
      .from("daybook_drafts")
      .select(
        "subject, rendered_html, validation_report, llm_model, llm_tokens_in, llm_tokens_out, composed_json",
      )
      .eq("run_id", run_id)
      .maybeSingle(),
    supabase
      .from("daybook_sources")
      .select("source_key, ok, http_status, bytes, error, fetched_at")
      .eq("run_id", run_id)
      .order("source_key"),
    supabase
      .from("daybook_sends")
      .select("id, provider, provider_message_id, archive_url, sent_at")
      .eq("run_id", run_id)
      .maybeSingle(),
  ]);

  if (runRes.error) {
    return <div className="p-6 text-red-600">DB error: {runRes.error.message}</div>;
  }
  const run = runRes.data;
  if (!run) return notFound();

  const draft = draftRes.data ?? null;
  const sources = sourcesRes.data ?? [];
  const send = sendRes.data ?? null;
  const validation = draft?.validation_report as
    | { passed: boolean; checks: { name: string; ok: boolean; detail?: string }[] }
    | null;

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link
          href="/admin/daybook"
          className="text-xs text-mip-gray-500 hover:underline"
        >
          ← All runs
        </Link>
      </div>

      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h1 className="mip-heading text-xl">
            {run.edition === "weekly" ? "Weekly Planner" : "Daybook"} —{" "}
            {run.publication_date}
          </h1>
          <p className="text-xs text-mip-gray-500 mt-1 font-mono">{run.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          {run.github_run_url && (
            <a
              href={run.github_run_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-mip-gray-500 hover:underline"
            >
              GHA log ↗
            </a>
          )}
        </div>
      </div>

      {run.error && (
        <div className="mb-4 p-3 border border-red-200 bg-red-50 rounded text-sm">
          <div className="font-semibold text-red-700 mb-1">Run error</div>
          <pre className="text-xs text-red-900 whitespace-pre-wrap break-all">
            {run.error}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: rendered preview */}
        <div className="lg:col-span-2">
          <h2 className="mip-heading text-sm uppercase tracking-wider text-mip-gray-600 mb-2">
            Rendered email
          </h2>
          {draft?.rendered_html ? (
            <div className="border border-mip-gray-200 rounded-md overflow-hidden bg-white">
              <div className="border-b border-mip-gray-200 px-3 py-2 bg-mip-gray-50">
                <div className="text-xs text-mip-gray-500">Subject</div>
                <div className="text-sm font-medium">{draft.subject}</div>
              </div>
              <iframe
                title="Daybook rendered email preview"
                srcDoc={draft.rendered_html}
                // No `allow-scripts` — this is a strict content sandbox.
                sandbox=""
                className="w-full"
                style={{ minHeight: "600px", border: "0" }}
              />
            </div>
          ) : (
            <div className="border border-dashed border-mip-gray-300 rounded-md p-8 text-center text-sm text-mip-gray-500">
              No draft yet. Run is at status <code>{run.status}</code>.
            </div>
          )}
        </div>

        {/* Right: metadata columns */}
        <div className="space-y-6">
          <section>
            <h2 className="mip-heading text-sm uppercase tracking-wider text-mip-gray-600 mb-2">
              LLM
            </h2>
            {draft?.llm_model ? (
              <dl className="text-xs space-y-1">
                <div className="flex justify-between">
                  <dt className="text-mip-gray-500">Model</dt>
                  <dd className="font-mono">{draft.llm_model}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mip-gray-500">Tokens in</dt>
                  <dd>{draft.llm_tokens_in ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mip-gray-500">Tokens out</dt>
                  <dd>{draft.llm_tokens_out ?? "—"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-mip-gray-500">Not composed yet.</p>
            )}
          </section>

          <section>
            <h2 className="mip-heading text-sm uppercase tracking-wider text-mip-gray-600 mb-2">
              Validation
            </h2>
            {validation ? (
              <div>
                <div
                  className={`text-xs mb-2 font-medium ${
                    validation.passed ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {validation.passed ? "✓ Passed" : "✗ Failed"}
                </div>
                <ul className="text-xs space-y-1">
                  {validation.checks.map((c) => (
                    <li key={c.name} className="flex items-start gap-2">
                      <span
                        className={c.ok ? "text-green-600" : "text-red-600"}
                      >
                        {c.ok ? "✓" : "✗"}
                      </span>
                      <span
                        className={
                          c.ok ? "text-mip-gray-700" : "text-red-700 font-medium"
                        }
                      >
                        {c.name}
                        {c.detail && (
                          <span className="text-mip-gray-500"> — {c.detail}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-mip-gray-500">No validation report.</p>
            )}
          </section>

          <section>
            <h2 className="mip-heading text-sm uppercase tracking-wider text-mip-gray-600 mb-2">
              Sources
            </h2>
            {sources.length === 0 ? (
              <p className="text-xs text-mip-gray-500">No fetches recorded.</p>
            ) : (
              <ul className="text-xs space-y-1">
                {sources.map((s) => (
                  <li key={s.source_key} className="flex items-baseline gap-2">
                    <span
                      className={s.ok ? "text-green-600" : "text-red-600"}
                    >
                      {s.ok ? "✓" : "✗"}
                    </span>
                    <span className="font-mono flex-1">{s.source_key}</span>
                    {s.http_status !== null && (
                      <span className="text-mip-gray-400">
                        {s.http_status}
                      </span>
                    )}
                    {s.error && !s.ok && (
                      <span
                        className="text-red-600 text-[10px] max-w-[150px] truncate"
                        title={s.error}
                      >
                        {s.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {send && (
            <section>
              <h2 className="mip-heading text-sm uppercase tracking-wider text-mip-gray-600 mb-2">
                Send
              </h2>
              <dl className="text-xs space-y-1">
                <div className="flex justify-between">
                  <dt className="text-mip-gray-500">Provider</dt>
                  <dd>{send.provider}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mip-gray-500">Sent at</dt>
                  <dd>
                    {new Date(send.sent_at).toLocaleString("en-US", {
                      timeZone: "America/New_York",
                    })}
                  </dd>
                </div>
                {send.archive_url && (
                  <div>
                    <a
                      href={send.archive_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-mip-purple hover:underline"
                    >
                      Archive URL ↗
                    </a>
                  </div>
                )}
              </dl>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    sent: "text-green-700 bg-green-50 border-green-200",
    mirrored: "text-green-700 bg-green-50 border-green-200",
    rendered: "text-blue-700 bg-blue-50 border-blue-200",
    composed: "text-blue-700 bg-blue-50 border-blue-200",
    fetched: "text-blue-700 bg-blue-50 border-blue-200",
    started: "text-gray-700 bg-gray-50 border-gray-200",
    failed: "text-red-700 bg-red-50 border-red-200",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium border ${
        colors[status] ?? "text-gray-700 bg-gray-100 border-gray-200"
      }`}
    >
      {status}
    </span>
  );
}

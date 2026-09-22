import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Daybook runs list. Shows the most recent 50 daybook_runs rows across
 * daybook + weekly editions, with a link to each run's preview page.
 *
 * This is the human-visible surface for a pipeline that otherwise lives
 * entirely inside GitHub Actions + Supabase, so operators can inspect a
 * run without opening the DB directly.
 */
export default async function DaybookRunsPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data: runs, error } = await supabase
    .from("daybook_runs")
    .select(
      "id, publication_date, edition, status, started_at, finished_at, error, github_run_url",
    )
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <div className="p-6">
        <h1 className="mip-heading text-xl mb-4">Daybook runs</h1>
        <p className="text-red-600">DB error: {error.message}</p>
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    sent: "text-green-700 bg-green-50",
    mirrored: "text-green-700 bg-green-50",
    rendered: "text-blue-700 bg-blue-50",
    composed: "text-blue-700 bg-blue-50",
    fetched: "text-blue-700 bg-blue-50",
    started: "text-gray-700 bg-gray-50",
    failed: "text-red-700 bg-red-50",
  };

  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="mip-heading text-xl">Daybook runs</h1>
        <span className="text-xs text-mip-gray-500">
          Most recent 50 runs · publication and rendered draft per run
        </span>
      </div>

      <div className="overflow-x-auto border border-mip-gray-200 rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-mip-gray-50 text-xs uppercase tracking-wide text-mip-gray-600">
            <tr>
              <th className="text-left px-3 py-2">Publication date</th>
              <th className="text-left px-3 py-2">Edition</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Started</th>
              <th className="text-left px-3 py-2">Finished</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(runs ?? []).map((run) => (
              <tr
                key={run.id}
                className="border-t border-mip-gray-100 hover:bg-mip-gray-50"
              >
                <td className="px-3 py-2 font-mono">{run.publication_date}</td>
                <td className="px-3 py-2">{run.edition}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      statusColor[run.status] ?? "text-gray-700 bg-gray-100"
                    }`}
                  >
                    {run.status}
                  </span>
                  {run.error && (
                    <span
                      className="ml-2 text-xs text-red-600"
                      title={run.error}
                    >
                      {run.error.length > 40
                        ? run.error.slice(0, 40) + "…"
                        : run.error}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-mip-gray-600">
                  {run.started_at
                    ? new Date(run.started_at).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-mip-gray-600">
                  {run.finished_at
                    ? new Date(run.finished_at).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/daybook/${run.id}`}
                    className="text-mip-purple hover:underline text-xs mr-3"
                  >
                    Preview
                  </Link>
                  {run.github_run_url && (
                    <a
                      href={run.github_run_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-mip-gray-500 hover:underline text-xs"
                    >
                      GHA log ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {(runs ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-mip-gray-500 text-sm"
                >
                  No runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

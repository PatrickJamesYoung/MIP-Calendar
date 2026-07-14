import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { IngestionPanel } from "./ingestion-panel";

export const dynamic = "force-dynamic";

export default async function IngestionPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data: runs } = await supabase
    .from("ingestion_runs")
    .select(
      "id, started_at, finished_at, status, fetched_count, new_count, submitted_count, skipped_count, auto_submit_count, by_source, error_message, triggered_by, runner_version"
    )
    .order("started_at", { ascending: false })
    .limit(50);

  // History size for the backfill card
  const { count: historyCount } = await supabase
    .from("ingestion_history")
    .select("id", { count: "exact", head: true });

  return <IngestionPanel runs={runs ?? []} historyCount={historyCount ?? 0} />;
}

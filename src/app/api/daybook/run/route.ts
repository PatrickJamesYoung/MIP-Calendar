/**
 * POST /api/daybook/run
 *
 * Starts a new Daybook or Weekly Planner run. Called by the GitHub Actions
 * workflow at the top of the schedule. Idempotent: if a run for
 * (publication_date, edition) already exists with status='sent' or
 * 'mirrored', responds 409 and the workflow aborts. This is the primary
 * duplicate-send defense at the run level; `daybook_sends` UNIQUE is the
 * defense at the send level.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/daybook/auth";

const Body = z.object({
  publication_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  edition: z.enum(["daybook", "weekly"]),
  github_run_id: z.string().optional(),
  github_run_url: z.string().url().optional(),
});

export async function POST(req: Request) {
  const guard = checkBearer(req);
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", detail: parsed.error.flatten() }, { status: 400 });
  }
  const { publication_date, edition, github_run_id, github_run_url } = parsed.data;

  const supabase = createAdminClient();

  // Duplicate-send guard: refuse if a terminal-success run already exists.
  const { data: existing, error: existingErr } = await supabase
    .from("daybook_runs")
    .select("id, status")
    .eq("publication_date", publication_date)
    .eq("edition", edition)
    .in("status", ["sent", "mirrored"])
    .maybeSingle();
  if (existingErr) {
    return NextResponse.json({ error: "db_error", detail: existingErr.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      { error: "already_sent", run_id: existing.id, status: existing.status },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("daybook_runs")
    .insert({
      publication_date,
      edition,
      status: "started",
      github_run_id: github_run_id ?? null,
      github_run_url: github_run_url ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "db_error", detail: error?.message }, { status: 500 });
  }

  return NextResponse.json({ run_id: data.id }, { status: 201 });
}

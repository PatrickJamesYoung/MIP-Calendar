/**
 * GET /api/spaces/check-conflict?start=<iso>&end=<iso>
 *
 * Public read-only conflict probe used by /spaces/reserve while the user
 * is filling out the form. Returns whether any tentative / approved /
 * in_use reservation overlaps the requested [start, end) window on ANY
 * space (a coarse "busy building" check — we intentionally do not scope
 * by the caller's picked spaces here, because the copy on the client
 * makes clear that a MIP organizer looks at the details before it's a
 * real scheduling conflict).
 *
 * Response is deliberately minimal: `{ ok, overlap, count }`. We don't
 * leak reservation details to unauthenticated storefront visitors.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { datetimeLocalToUtcIso } from "@/lib/ingest/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["tentative", "approved", "in_use"] as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      { ok: false, error: "missing-start-or-end" },
      { status: 400 }
    );
  }

  // Match the parsing behavior of the server action (actions.ts): the
  // reserve form's datetime-local inputs are wall-clock Eastern time, not
  // UTC. Interpret them the same way here so the conflict probe queries
  // the same instant that would eventually be written to the DB.
  let startMs: number, endMs: number;
  try {
    startMs = new Date(datetimeLocalToUtcIso(start)).getTime();
    endMs = new Date(datetimeLocalToUtcIso(end)).getTime();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid-date" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return NextResponse.json(
      { ok: false, error: "invalid-date" },
      { status: 400 }
    );
  }
  if (endMs <= startMs) {
    // Empty or backwards window — nothing to conflict with.
    return NextResponse.json({ ok: true, overlap: false, count: 0 });
  }

  const supabase = createAdminClient();

  // Two ranges overlap iff A.start < B.end AND A.end > B.start.
  // We use load_in_at → load_out_at on the existing reservations because
  // the whole building is effectively busy during load-in and load-out
  // too, and we want that to trigger the "heads up" warning.
  const { count, error } = await supabase
    .from("spaces_reservations")
    .select("id", { count: "exact", head: true })
    .in("status", ACTIVE_STATUSES)
    .lt("load_in_at", new Date(endMs).toISOString())
    .gt("load_out_at", new Date(startMs).toISOString());

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const n = count ?? 0;
  return NextResponse.json({ ok: true, overlap: n > 0, count: n });
}

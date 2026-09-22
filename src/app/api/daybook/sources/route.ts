/**
 * POST /api/daybook/sources
 *
 * Records the outcome of a source fetch. The Python fetcher calls this
 * once per source. Non-fatal failures are recorded with ok=false and do
 * NOT block the run; the hard-requirement check happens in /compose.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkBearer } from "@/lib/daybook/auth";
import { SOURCE_KEYS } from "@/lib/daybook/types";

// Nullable AND optional: the Python fetcher always sends every key even
// when the value is unknown (it sends null). Zod's .optional() alone
// accepts undefined only, not null, so we must .nullable().optional() to
// let JSON nulls through.
const Body = z.object({
  run_id: z.string().uuid(),
  source_key: z.enum(SOURCE_KEYS),
  ok: z.boolean(),
  http_status: z.number().int().nullable().optional(),
  bytes: z.number().int().nullable().optional(),
  payload: z.unknown().nullable().optional(),
  error: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const guard = checkBearer(req);
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", detail: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = createAdminClient();
  const { error } = await supabase.from("daybook_sources").upsert(
    {
      run_id: body.run_id,
      source_key: body.source_key,
      ok: body.ok,
      http_status: body.http_status ?? null,
      bytes: body.bytes ?? null,
      payload: body.payload ?? null,
      error: body.error ?? null,
    },
    { onConflict: "run_id,source_key" },
  );
  if (error) {
    return NextResponse.json({ error: "db_error", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Backfill `ingestion_history` from a JSONL file bundled at
 * `dc_events_export/events_history.jsonl`. Idempotent: each row is inserted
 * only if a matching (source_name, title, event_date) triple isn't already
 * present.
 *
 * This is meant to run ONCE per environment to seed the dedup baseline so
 * bi-weekly runs don't re-submit the 873 historical events.
 *
 * Reads from the app root at runtime. In dev, the file lives at
 * `<repo>/../dc_events_export/events_history.jsonl`; in prod on Vercel the
 * file needs to be committed to the repo (see: same relative path). If it
 * can't find the file, returns an error asking to run this locally.
 */
export async function backfillHistoryAction(): Promise<
  | { ok: true; imported: number; skipped: number; total: number }
  | { ok: false; error: string }
> {
  await requireSuperAdmin();

  // Locate the bundled JSONL. Prefer the repo-local `data/` path (works on Vercel).
  const candidates = [
    path.join(process.cwd(), "data", "events_history.jsonl"),
    path.join(process.cwd(), "..", "dc_events_export", "events_history.jsonl"),
  ];

  let content: string | null = null;
  let usedPath: string | null = null;
  for (const p of candidates) {
    try {
      content = await readFile(p, "utf-8");
      usedPath = p;
      break;
    } catch {
      /* try next */
    }
  }

  if (!content) {
    return {
      ok: false,
      error: `events_history.jsonl not found. Tried: ${candidates.join(" | ")}`,
    };
  }

  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const supabase = createAdminClient();

  let imported = 0;
  let skipped = 0;

  // Read all existing (source, title, date) triples in one pass.
  const { data: existing } = await supabase
    .from("ingestion_history")
    .select("source_name, title, event_date")
    .limit(50000);

  const seen = new Set<string>();
  for (const e of existing ?? []) {
    const key = `${(e.source_name ?? "").toLowerCase()}|${(e.title ?? "").toLowerCase().trim()}|${(e.event_date ?? "").trim()}`;
    seen.add(key);
  }

  // Batch inserts in groups of 250 for speed.
  const BATCH = 250;
  const rowsToInsert: Array<{
    source_name: string;
    title: string;
    event_date: string | null;
    event_time: string | null;
    event_url: string | null;
    raw: unknown;
  }> = [];

  for (const line of lines) {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const source = String(row["Source"] ?? "").trim();
    const title = String(row["Title"] ?? "").trim();
    const dateS = String(row["Date"] ?? "").trim();
    if (!source || !title) {
      skipped++;
      continue;
    }
    const key = `${source.toLowerCase()}|${title.toLowerCase()}|${dateS}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    rowsToInsert.push({
      source_name: source,
      title,
      event_date: dateS || null,
      event_time: (row["Time"] ? String(row["Time"]) : null) || null,
      event_url: (row["Event URL"] ? String(row["Event URL"]) : null) || null,
      raw: row,
    });
  }

  for (let i = 0; i < rowsToInsert.length; i += BATCH) {
    const chunk = rowsToInsert.slice(i, i + BATCH);
    const { error } = await supabase.from("ingestion_history").insert(chunk);
    if (error) {
      return { ok: false, error: `Insert failed at row ${i}: ${error.message}` };
    }
    imported += chunk.length;
  }

  console.log(`[ingestion-backfill] source=${usedPath} imported=${imported} skipped=${skipped}`);
  revalidatePath("/admin/ingestion");

  return { ok: true, imported, skipped, total: lines.length };
}

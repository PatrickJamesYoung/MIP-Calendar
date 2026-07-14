"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TRUMBA_ICS_URL,
  parseTrumbaFeed,
  filterUpcoming,
  type ParsedTrumbaEvent,
} from "@/lib/trumba-import";

export interface ImportPreview {
  total_upcoming: number;
  will_create: number;
  will_update: number;
  by_category: Array<{ category: string; count: number; overlay_matched: boolean }>;
  by_event_type: Array<{ event_type: string; count: number; matched: boolean }>;
  samples: ParsedTrumbaEvent[];
  fetched_at: string;
}

/**
 * Fetch the Trumba feed, parse it, and return a summary of what an import
 * would do. Does NOT write anything. Used by the /admin/import UI.
 */
export async function previewTrumbaImportAction(): Promise<
  { ok: true; preview: ImportPreview } | { ok: false; error: string }
> {
  try {
    await requireSuperAdmin();
  } catch {
    return { ok: false, error: "Only super admins can run imports." };
  }

  try {
    const res = await fetch(TRUMBA_ICS_URL, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `Trumba feed returned ${res.status}` };
    }
    const ics = await res.text();
    const all = parseTrumbaFeed(ics);
    const upcoming = filterUpcoming(all);

    const supabase = createAdminClient();

    // Fetch overlays and event_types once for matching
    const [{ data: overlays }, { data: eventTypes }, { data: existing }] =
      await Promise.all([
        supabase.from("overlay_calendars").select("id, name, slug"),
        supabase.from("event_types").select("id, name, slug"),
        supabase
          .from("events")
          .select("external_id")
          .not("external_id", "is", null),
      ]);

    const overlayNames = new Set((overlays ?? []).map((o) => o.name.toLowerCase()));
    const eventTypeNames = new Set(
      (eventTypes ?? []).map((t) => t.name.toLowerCase())
    );
    const existingIds = new Set(
      (existing ?? []).map((e: { external_id: string | null }) => e.external_id)
    );

    // Category breakdown
    const catCounts = new Map<string, number>();
    for (const e of upcoming) {
      const c = e.category ?? "(no category)";
      catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
    }
    const by_category = [...catCounts.entries()]
      .map(([category, count]) => ({
        category,
        count,
        overlay_matched: overlayNames.has(category.toLowerCase()),
      }))
      .sort((a, b) => b.count - a.count);

    // Event type breakdown
    const typeCounts = new Map<string, number>();
    for (const e of upcoming) {
      const t = e.event_type_name ?? "(unset)";
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    const by_event_type = [...typeCounts.entries()]
      .map(([event_type, count]) => ({
        event_type,
        count,
        matched:
          event_type === "(unset)"
            ? true
            : eventTypeNames.has(event_type.toLowerCase()),
      }))
      .sort((a, b) => b.count - a.count);

    let will_create = 0;
    let will_update = 0;
    for (const e of upcoming) {
      if (existingIds.has(e.external_id)) will_update++;
      else will_create++;
    }

    return {
      ok: true,
      preview: {
        total_upcoming: upcoming.length,
        will_create,
        will_update,
        by_category,
        by_event_type,
        samples: upcoming.slice(0, 5),
        fetched_at: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Idempotently upsert all upcoming Trumba events into the events table.
 * Uses external_id as the natural key. Sets source='trumba'.
 * Skips past events. Maps category → overlay_calendar_id and
 * event_type_name → event_type_id when a match exists.
 */
export async function runTrumbaImportAction(): Promise<
  | {
      ok: true;
      created: number;
      updated: number;
      skipped_unmatched_category: string[];
      skipped_errors: Array<{ title: string; error: string }>;
    }
  | { ok: false; error: string }
> {
  let admin;
  try {
    admin = await requireSuperAdmin();
  } catch {
    return { ok: false, error: "Only super admins can run imports." };
  }

  try {
    const res = await fetch(TRUMBA_ICS_URL, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `Trumba feed returned ${res.status}` };
    const ics = await res.text();
    const upcoming = filterUpcoming(parseTrumbaFeed(ics));

    const supabase = createAdminClient();

    // Load lookup maps
    const [
      { data: overlays },
      { data: eventTypes },
      { data: existing },
    ] = await Promise.all([
      supabase.from("overlay_calendars").select("id, name"),
      supabase.from("event_types").select("id, name"),
      supabase
        .from("events")
        .select("id, external_id, slug")
        .not("external_id", "is", null),
    ]);

    const overlayByName = new Map<string, string>();
    for (const o of overlays ?? []) overlayByName.set(o.name.toLowerCase(), o.id);
    const eventTypeByName = new Map<string, string>();
    for (const t of eventTypes ?? []) eventTypeByName.set(t.name.toLowerCase(), t.id);
    const existingByExtId = new Map<string, { id: string; slug: string | null }>();
    for (const e of existing ?? []) {
      if (e.external_id) existingByExtId.set(e.external_id, { id: e.id, slug: e.slug });
    }

    // Also load slugs of NON-trumba events so we don't collide when auto-slugging.
    const { data: allSlugsData } = await supabase.from("events").select("slug");
    const takenSlugs = new Set(
      (allSlugsData ?? []).map((r: { slug: string | null }) => r.slug).filter(Boolean) as string[]
    );

    let created = 0;
    let updated = 0;
    const skipped_unmatched_category: string[] = [];
    const skipped_errors: Array<{ title: string; error: string }> = [];

    for (const e of upcoming) {
      try {
        const overlay_calendar_id = e.category
          ? overlayByName.get(e.category.toLowerCase()) ?? null
          : null;
        if (e.category && !overlay_calendar_id) {
          if (!skipped_unmatched_category.includes(e.category)) {
            skipped_unmatched_category.push(e.category);
          }
        }
        const event_type_id = e.event_type_name
          ? eventTypeByName.get(e.event_type_name.toLowerCase()) ?? null
          : null;

        const isUpdate = existingByExtId.has(e.external_id);
        const existingRow = existingByExtId.get(e.external_id);

        // Pick a unique slug. For updates, keep the existing slug so external
        // links don't break. For creates, disambiguate against taken slugs.
        let slug = e.slug;
        if (isUpdate && existingRow?.slug) {
          slug = existingRow.slug;
        } else if (takenSlugs.has(slug)) {
          const suffix = e.external_id.slice(-6).replace(/[^a-z0-9]/gi, "").toLowerCase();
          slug = `${e.slug}-${suffix}`;
        }
        takenSlugs.add(slug);

        const row = {
          title: e.title,
          slug,
          description: e.description,
          starts_at: e.starts_at,
          ends_at: e.ends_at,
          all_day: e.all_day,
          timezone: e.timezone,
          location_text: e.location_text,
          location_type: e.location_type,
          image_url: e.image_url,
          cost: e.cost,
          host_org: e.host_org,
          web_link: e.web_link,
          overlay_calendar_id,
          event_type_id,
          external_id: e.external_id,
          source: "trumba" as const,
          status: "published" as const,
          created_by: admin.id,
        };

        if (isUpdate && existingRow) {
          const { error } = await supabase
            .from("events")
            .update(row)
            .eq("id", existingRow.id);
          if (error) throw new Error(error.message);
          updated++;
        } else {
          const { error } = await supabase.from("events").insert(row);
          if (error) throw new Error(error.message);
          created++;
        }
      } catch (err) {
        skipped_errors.push({ title: e.title, error: (err as Error).message });
      }
    }

    // Audit log
    await supabase.from("audit_log").insert({
      admin_id: admin.id,
      action: "trumba_import",
      entity_type: "events",
      entity_id: null,
      diff: {
        created,
        updated,
        skipped_errors_count: skipped_errors.length,
        unmatched_categories: skipped_unmatched_category,
      },
    });

    revalidatePath("/");
    revalidatePath("/admin");

    return {
      ok: true,
      created,
      updated,
      skipped_unmatched_category,
      skipped_errors,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

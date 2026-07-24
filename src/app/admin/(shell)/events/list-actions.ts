"use server";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const EVENT_COLUMNS =
  "id, title, slug, starts_at, ends_at, all_day, timezone, is_featured, status, image_url, overlay_calendar_id, overlay_calendar:overlay_calendars(id, name, slug, color, default_visible, sort_order, description)";

/**
 * Fetch a page of upcoming or past events for the admin dashboard.
 * Server action so the client "Show more" button can request more without a full page reload.
 * Returns rows + a hasMore flag (true when a full page was returned).
 */
export async function fetchAdminEventsPage(params: {
  scope: "upcoming" | "past";
  offset: number;
  pageSize: number;
}) {
  await requireAdmin();
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { scope, offset, pageSize } = params;

  const pageLimit = Math.min(Math.max(pageSize, 1), 200);
  const from = Math.max(offset, 0);
  const to = from + pageLimit - 1;

  const query = supabase.from("events").select(EVENT_COLUMNS).range(from, to);

  const { data, error } =
    scope === "upcoming"
      ? await query
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
      : await query
          .lt("starts_at", nowIso)
          .order("starts_at", { ascending: false });

  if (error) {
    return { rows: [], hasMore: false, error: error.message };
  }

  const rows = data ?? [];
  return {
    rows,
    hasMore: rows.length === pageLimit,
    error: null,
  };
}

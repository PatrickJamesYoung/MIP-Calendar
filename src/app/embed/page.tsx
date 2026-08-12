import { CalendarShell } from "@/components/calendar-shell";
import { createClient } from "@/lib/supabase/server";
import type { CalendarEvent, OverlayCalendar } from "@/lib/types";

// Embed-only view of the calendar. Mirrors /calendar's data-fetch logic
// exactly (same 60-day-back / end-of-following-year window, same published
// filter), but renders only CalendarShell —
// no SiteHeader, no SiteFooter, no navigation. Designed for use in an
// <iframe> from movementinfrastructureproject.org/calendar.

export const dynamic = "force-dynamic";

export default async function EmbedPage() {
  const supabase = await createClient();

  const startWindow = new Date();
  startWindow.setDate(startWindow.getDate() - 60);
  const endWindow = new Date();
  endWindow.setFullYear(endWindow.getFullYear() + 1);

  const [{ data: overlays, error: overlaysError }, { data: events, error: eventsError }] = await Promise.all([
    supabase
      .from("overlay_calendars")
      .select("*")
      .order("sort_order"),
    supabase
      .from("events")
      .select(
        "*, overlay_calendar:overlay_calendars(*), event_type:event_types(*)"
      )
      .eq("status", "published")
      .gte("starts_at", startWindow.toISOString())
      .lte("starts_at", endWindow.toISOString())
      .order("starts_at", { ascending: true })
      .limit(2000),
  ]);

  if (overlaysError) console.error("[embed] overlays fetch failed:", overlaysError);
  if (eventsError) console.error("[embed] events fetch failed:", eventsError);

  const displayEvents = (events ?? []) as CalendarEvent[];
  const displayOverlays = (overlays ?? []) as OverlayCalendar[];

  return <CalendarShell events={displayEvents} overlays={displayOverlays} />;
}

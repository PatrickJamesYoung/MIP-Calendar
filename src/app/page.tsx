import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CalendarShell } from "@/components/calendar-shell";
import { createClient } from "@/lib/supabase/server";
import { SAMPLE_EVENTS, SAMPLE_OVERLAYS } from "@/lib/sample-data";
import type { CalendarEvent, OverlayCalendar } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();

  // Widen the window: grid views (month/week) need events from the recent past.
  // 60 days back lets someone pick any month or week within roughly the last
  // two months without an extra fetch. Future events fetched to the end of
  // the following year.
  const startWindow = new Date();
  startWindow.setDate(startWindow.getDate() - 60);
  const endWindow = new Date();
  endWindow.setFullYear(endWindow.getFullYear() + 1);

  const [{ data: overlays }, { data: events }] = await Promise.all([
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

  const hasData = (events?.length ?? 0) > 0 && (overlays?.length ?? 0) > 0;

  // Fall back to sample data if the DB is empty so the page never looks broken
  // during initial setup or if RLS is misconfigured.
  const displayEvents = (hasData ? events : SAMPLE_EVENTS) as CalendarEvent[];
  const displayOverlays = (hasData ? overlays : SAMPLE_OVERLAYS) as OverlayCalendar[];

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <CalendarShell events={displayEvents} overlays={displayOverlays} />
      <SiteFooter />
    </div>
  );
}

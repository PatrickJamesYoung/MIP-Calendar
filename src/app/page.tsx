import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CalendarShell } from "@/components/calendar-shell";
import { SAMPLE_EVENTS, SAMPLE_OVERLAYS } from "@/lib/sample-data";

export default function HomePage() {
  // TODO: replace with real Supabase queries once schema is deployed.
  const now = new Date();
  const upcomingEvents = SAMPLE_EVENTS.filter(
    (e) => new Date(e.starts_at) >= now
  ).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <CalendarShell events={upcomingEvents} overlays={SAMPLE_OVERLAYS} />
      <SiteFooter />
    </div>
  );
}

import Link from "next/link";
import { MipSiteHeader } from "@/components/mip-site-header";
import { SiteFooter } from "@/components/site-footer";
import { CalendarShell } from "@/components/calendar-shell";
import { createClient } from "@/lib/supabase/server";
import { SAMPLE_EVENTS, SAMPLE_OVERLAYS } from "@/lib/sample-data";
import type { CalendarEvent, OverlayCalendar } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Movement Calendar — Movement Infrastructure Project",
  description:
    "A resource for our community, to help people find ways to plug into actions and events, support organizers in getting the word out, and compile important dates in our political and economic landscape.",
};

export default async function CalendarPage() {
  const supabase = await createClient();

  const startWindow = new Date();
  startWindow.setDate(startWindow.getDate() - 60);
  const endWindow = new Date();
  endWindow.setFullYear(endWindow.getFullYear() + 1);

  const [{ data: overlays }, { data: events }] = await Promise.all([
    supabase.from("overlay_calendars").select("*").order("sort_order"),
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
  const displayEvents = (hasData ? events : SAMPLE_EVENTS) as CalendarEvent[];
  const displayOverlays = (hasData
    ? overlays
    : SAMPLE_OVERLAYS) as OverlayCalendar[];

  return (
    <div className="min-h-screen flex flex-col">
      <MipSiteHeader />

      {/* Intro copy — mirrors the intro on movementinfrastructureproject.org/calendar */}
      <section
        className="mx-auto w-full px-6 pt-10 pb-6"
        style={{ maxWidth: "1200px" }}
      >
        <h1 className="mip-heading text-3xl md:text-4xl mb-4" style={{ color: "var(--color-mip-purple)" }}>
          Movement Calendar
        </h1>
        <div className="space-y-4 max-w-3xl text-[16px] leading-relaxed text-mip-gray-900">
          <p>
            This movement calendar is a resources for our community, to help
            people find ways to plug into actions and events, support
            organizers in getting the word out about their actions and compile
            important dates in our political and economic landscape to help
            with planning and strategy development. Events on the calendar
            were compiled from social media, email blasts and community
            submissions.{" "}
            <strong>
              Unless it&apos;s otherwise stated, the Movement Infrastructure
              Project did not organize these actions or events and including
              them here is not an endorsement of these events.
            </strong>
          </p>
          <p>
            Know about an action or event that should be included in the
            calendar? Click here to read the{" "}
            <a
              href="https://www.movementinfrastructureproject.org/calendar-submission-guidelines"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-mip-purple"
              style={{ color: "var(--color-mip-purple)" }}
            >
              submission guidelines
            </a>{" "}
            and{" "}
            <Link
              href="/submit"
              className="underline hover:text-mip-purple"
              style={{ color: "var(--color-mip-purple)" }}
            >
              add it below
            </Link>
            !
          </p>
        </div>
      </section>

      <CalendarShell events={displayEvents} overlays={displayOverlays} />
      <SiteFooter />
    </div>
  );
}

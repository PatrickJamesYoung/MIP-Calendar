import { NextResponse } from "next/server";
import { createEvents, type EventAttributes } from "ics";
import { createClient } from "@/lib/supabase/server";
import type { CalendarEvent } from "@/lib/types";

// Never cache the feed at the framework level — calendar clients cache on
// their own schedule and we always want them to see the current state.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Public iCalendar feed for the entire calendar.
 *
 * Query parameters:
 *   - overlay: overlay slug (e.g. ?overlay=movement) or comma-separated
 *              list (?overlay=movement,elections). If omitted, all overlays.
 *   - past_days: how many days of past events to include (default 30, max 365)
 *
 * The response includes only published events. Times are emitted in UTC
 * to match what's stored in the database — calendar clients will convert
 * to the viewer's local timezone.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const overlayParam = url.searchParams.get("overlay");
  const pastDaysRaw = parseInt(url.searchParams.get("past_days") ?? "30", 10);
  const pastDays = Number.isFinite(pastDaysRaw)
    ? Math.min(Math.max(pastDaysRaw, 0), 365)
    : 30;

  const supabase = await createClient();

  // Resolve overlay filter to overlay IDs
  let overlayIds: string[] | null = null;
  let overlayLabel = "All calendars";
  if (overlayParam) {
    const slugs = overlayParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (slugs.length > 0) {
      const { data: overlays } = await supabase
        .from("overlay_calendars")
        .select("id, name, slug")
        .in("slug", slugs);
      overlayIds = (overlays ?? []).map((o) => o.id);
      overlayLabel =
        (overlays ?? []).map((o) => o.name).join(", ") || "All calendars";
      if (overlayIds.length === 0) {
        // No matching overlays — return empty (valid) feed instead of erroring
        return icsResponse(emptyCalendar(overlayLabel));
      }
    }
  }

  // Fetch events
  const nowMinusPast = new Date(
    Date.now() - pastDays * 24 * 60 * 60 * 1000
  ).toISOString();

  let q = supabase
    .from("events")
    .select("*")
    .eq("status", "published")
    .gte("starts_at", nowMinusPast)
    .order("starts_at", { ascending: true })
    .limit(2000);

  if (overlayIds) {
    q = q.in("overlay_calendar_id", overlayIds);
  }

  const { data: events, error } = await q;

  if (error) {
    console.error("[calendar.ics] db error", error);
    return new NextResponse("Failed to load calendar", { status: 500 });
  }

  const attrs = (events ?? []).map(eventToIcs).filter((a): a is EventAttributes => a !== null);

  const { error: icsError, value } = createEvents(attrs, {
    calName: overlayLabel === "All calendars"
      ? "MIP Movement Calendar"
      : `MIP Movement Calendar — ${overlayLabel}`,
    productId: "-//Movement Infrastructure Project//MIP Calendar//EN",
  });

  if (icsError || !value) {
    console.error("[calendar.ics] createEvents error", icsError);
    return new NextResponse("Failed to build calendar", { status: 500 });
  }

  // Inject the Apple/Outlook-friendly refresh interval + timezone hints
  // (ics package doesn't expose these directly, so we splice them in).
  const withHints = value
    .replace(
      "PRODID:-//Movement Infrastructure Project//MIP Calendar//EN",
      [
        "PRODID:-//Movement Infrastructure Project//MIP Calendar//EN",
        "X-WR-CALNAME:" +
          (overlayLabel === "All calendars"
            ? "MIP Movement Calendar"
            : `MIP Movement Calendar — ${overlayLabel}`),
        "X-WR-TIMEZONE:America/New_York",
        // Refresh every hour on clients that support it
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
      ].join("\r\n")
    );

  return icsResponse(withHints);
}

function eventToIcs(event: CalendarEvent): EventAttributes | null {
  try {
    const start = new Date(event.starts_at);
    const end = event.ends_at
      ? new Date(event.ends_at)
      : new Date(start.getTime() + 60 * 60 * 1000);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

    const attrs: EventAttributes = {
      uid: `${event.id}@mip-calendar.movementinfrastructureproject.org`,
      title: event.title,
      description: buildDescription(event),
      location: event.location_text ?? undefined,
      url: event.web_link ?? undefined,
      startInputType: "utc",
      endInputType: "utc",
      start: [
        start.getUTCFullYear(),
        start.getUTCMonth() + 1,
        start.getUTCDate(),
        start.getUTCHours(),
        start.getUTCMinutes(),
      ],
      end: [
        end.getUTCFullYear(),
        end.getUTCMonth() + 1,
        end.getUTCDate(),
        end.getUTCHours(),
        end.getUTCMinutes(),
      ],
      productId: "mip-calendar/ics",
      status: "CONFIRMED",
      // Stamp last-modified so calendar clients know to update
      lastModified: dateToIcsArray(new Date(event.updated_at ?? event.created_at ?? event.starts_at)),
      calName: "MIP Movement Calendar",
    };
    return attrs;
  } catch (e) {
    console.warn("[calendar.ics] skipping bad event", event.id, e);
    return null;
  }
}

function dateToIcsArray(d: Date): [number, number, number, number, number] {
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ];
}

function buildDescription(event: CalendarEvent): string {
  const parts: string[] = [];
  if (event.description) {
    // Strip HTML tags — calendar clients render plain text
    const plain = event.description
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (plain) parts.push(plain);
  }
  if (event.host_org) parts.push(`Host: ${event.host_org}`);
  if (event.cost) parts.push(`Cost: ${event.cost}`);
  if (event.slug) {
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://mip-calendar.vercel.app";
    parts.push(`More info: ${siteUrl}/e/${event.slug}`);
  }
  return parts.join("\n\n");
}

function emptyCalendar(label: string): string {
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Movement Infrastructure Project//MIP Calendar//EN",
    `X-WR-CALNAME:MIP Movement Calendar — ${label}`,
    "X-WR-TIMEZONE:America/New_York",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    `DTSTAMP:${now}`,
    "END:VCALENDAR",
  ].join("\r\n");
}

function icsResponse(body: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="mip-calendar.ics"',
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}

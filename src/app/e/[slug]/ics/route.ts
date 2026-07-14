import { NextResponse } from "next/server";
import { createEvent, type EventAttributes } from "ics";
import { createClient } from "@/lib/supabase/server";
import { SAMPLE_EVENTS } from "@/lib/sample-data";
import type { CalendarEvent } from "@/lib/types";

/**
 * Serve a single event as an iCalendar .ics file for Apple Calendar / Outlook.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  const event =
    (data as CalendarEvent | null) ??
    (SAMPLE_EVENTS as CalendarEvent[]).find((e) => e.slug === slug) ??
    null;

  if (!event) {
    return new NextResponse("Event not found", { status: 404 });
  }

  const start = new Date(event.starts_at);
  const end = event.ends_at
    ? new Date(event.ends_at)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const attrs: EventAttributes = {
    title: event.title,
    description: event.description ?? undefined,
    location: event.location_text ?? undefined,
    url: event.web_link ?? undefined,
    // ics expects [year, month, day, hour, minute] in UTC when startInputType is 'utc'
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
    uid: `${event.id}@mip-calendar`,
  };

  const { error, value } = createEvent(attrs);
  if (error || !value) {
    return new NextResponse(`Failed to build ics: ${error?.message ?? "unknown"}`, {
      status: 500,
    });
  }

  return new NextResponse(value, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug || "event"}.ics"`,
    },
  });
}

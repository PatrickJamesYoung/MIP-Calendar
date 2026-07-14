import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  ExternalLink,
  Star,
  Calendar as CalendarIcon,
  Download,
  Clock,
  DollarSign,
  Users,
  Video,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { formatDateBadge, formatTimeRange } from "@/lib/utils";
import { ACCESSIBILITY_LABELS } from "@/lib/types";
import type {
  AccessibilityFeature,
  CalendarEvent,
  OverlayCalendar,
  EventType,
} from "@/lib/types";
import { SAMPLE_EVENTS } from "@/lib/sample-data";
import { prepareDescription } from "@/lib/event-description";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

// Sample events use hard-coded slugs — allow deep-linking to them in dev/preview.
function findInSampleData(slug: string): CalendarEvent | null {
  return (SAMPLE_EVENTS as CalendarEvent[]).find((e) => e.slug === slug) ?? null;
}

export default async function EventDetailPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("*, overlay_calendar:overlay_calendars(*), event_type:event_types(*)")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  const resolved = (event as CalendarEvent | null) ?? findInSampleData(slug);

  if (!resolved) notFound();

  const badge = formatDateBadge(resolved.starts_at, resolved.timezone);
  const time = formatTimeRange(
    resolved.starts_at,
    resolved.ends_at,
    resolved.all_day,
    resolved.timezone
  );
  // Supabase's typed joins can arrive as arrays even for to-one relationships.
  const overlayRaw = resolved.overlay_calendar as
    | OverlayCalendar
    | OverlayCalendar[]
    | undefined;
  const overlay = Array.isArray(overlayRaw) ? overlayRaw[0] : overlayRaw;
  const eventTypeRaw = resolved.event_type as
    | EventType
    | EventType[]
    | undefined;
  const eventType = Array.isArray(eventTypeRaw) ? eventTypeRaw[0] : eventTypeRaw;

  const googleCalUrl = buildGoogleCalendarUrl(resolved);
  const icsUrl = `/e/${slug}/ics`;
  const cleanDescription = prepareDescription(resolved.description);

  // Full weekday + date label ("Tuesday, July 14, 2026")
  const fullDate = new Date(resolved.starts_at).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: resolved.timezone || "America/New_York",
  });

  const overlayColor = overlay?.color ?? "var(--color-mip-purple)";

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <div
          className="border-b border-mip-gray-200"
          style={{
            backgroundColor: "var(--color-mip-cream, #faf7f0)",
          }}
        >
          <div
            className="mx-auto w-full px-6 pt-6 pb-8"
            style={{ maxWidth: "var(--max-width-content)" }}
          >
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs text-mip-gray-500 hover:text-mip-purple mb-6"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to calendar
            </Link>

            <div className="grid md:grid-cols-[1fr_360px] gap-8 items-start">
              {/* Left: title, chips, meta */}
              <div>
                {/* Chips */}
                <div className="flex items-center gap-2 flex-wrap mb-4">
                  {resolved.is_featured && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-1"
                      style={{
                        backgroundColor: "var(--color-mip-yellow)",
                        color: "var(--color-mip-purple)",
                        borderRadius: "var(--radius-button)",
                      }}
                    >
                      <Star className="w-3 h-3 fill-mip-purple" />
                      Priority
                    </span>
                  )}
                  {overlay && (
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold px-2.5 py-1"
                      style={{
                        color: overlay.color,
                        backgroundColor: `${overlay.color}18`,
                        borderRadius: "var(--radius-button)",
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: overlay.color }}
                      />
                      {overlay.name}
                    </span>
                  )}
                  {eventType && (
                    <span className="text-[11px] uppercase tracking-wider font-bold text-mip-gray-700">
                      {eventType.name}
                    </span>
                  )}
                </div>

                <h1
                  className="mip-heading text-3xl md:text-4xl lg:text-5xl leading-tight mip-double-underline inline-block pb-1"
                  style={{ color: "var(--color-mip-purple)" }}
                >
                  {resolved.title}
                </h1>

                {resolved.host_org && (
                  <p className="mt-5 text-base text-mip-gray-700">
                    Hosted by{" "}
                    <strong className="text-mip-gray-900">{resolved.host_org}</strong>
                  </p>
                )}

                {/* At-a-glance meta row */}
                <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-mip-gray-700">
                  <div className="inline-flex items-center gap-1.5">
                    <CalendarIcon className="w-4 h-4" style={{ color: overlayColor }} />
                    <span>{fullDate}</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5">
                    <Clock className="w-4 h-4" style={{ color: overlayColor }} />
                    <span>{time}</span>
                  </div>
                  {resolved.location_text && (
                    <div className="inline-flex items-center gap-1.5">
                      {resolved.location_type === "online" ? (
                        <Video className="w-4 h-4" style={{ color: overlayColor }} />
                      ) : (
                        <MapPin className="w-4 h-4" style={{ color: overlayColor }} />
                      )}
                      <span className="truncate max-w-xs">{resolved.location_text}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: date block */}
              <div className="md:justify-self-end">
                <div
                  className="w-full md:w-auto flex flex-col items-center justify-center text-center px-6 py-4"
                  style={{
                    backgroundColor: overlayColor,
                    color: "var(--color-mip-white)",
                    borderRadius: "var(--radius-button)",
                    minWidth: 128,
                  }}
                >
                  <div className="text-[11px] font-bold uppercase tracking-wider opacity-90 leading-none">
                    {badge.month}
                  </div>
                  <div className="text-5xl font-bold leading-none mt-1">
                    {badge.day}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider opacity-90 leading-none mt-2">
                    {badge.weekday}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          className="mx-auto w-full px-6 py-10"
          style={{ maxWidth: "var(--max-width-content)" }}
        >
          <div className="grid md:grid-cols-[1fr_320px] gap-10">
            {/* Main column */}
            <article>
              {resolved.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolved.image_url}
                  alt=""
                  className="w-full max-h-[480px] object-cover mb-8"
                  style={{ borderRadius: "var(--radius-button)" }}
                />
              )}

              {cleanDescription ? (
                <>
                  <h2
                    className="mip-nav-text mb-4"
                    style={{ color: "var(--color-mip-purple)" }}
                  >
                    About this event
                  </h2>
                  <div
                    className="event-description text-base text-mip-gray-900 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: cleanDescription }}
                  />
                </>
              ) : (
                <p className="text-sm text-mip-gray-500 italic">
                  No description provided.
                </p>
              )}

              {resolved.accessibility && resolved.accessibility.length > 0 && (
                <div className="mt-10 pt-6 border-t border-mip-gray-200">
                  <h2
                    className="mip-nav-text mb-3"
                    style={{ color: "var(--color-mip-purple)" }}
                  >
                    Accessibility
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {resolved.accessibility.map((a: AccessibilityFeature) => (
                      <span
                        key={a}
                        className="text-xs px-2.5 py-1"
                        style={{
                          backgroundColor: "var(--color-mip-cyan)",
                          color: "var(--color-mip-purple)",
                          borderRadius: "var(--radius-button)",
                        }}
                      >
                        {ACCESSIBILITY_LABELS[a]}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </article>

            {/* Sidebar */}
            <aside className="md:sticky md:top-6 md:self-start space-y-4">
              {/* Primary details card */}
              <div
                className="border border-mip-gray-200 p-5 bg-white"
                style={{ borderRadius: "var(--radius-button)" }}
              >
                <h3
                  className="mip-nav-text mb-4"
                  style={{ color: "var(--color-mip-purple)" }}
                >
                  Event details
                </h3>

                <dl className="space-y-4 text-sm">
                  <div className="flex items-start gap-3">
                    <CalendarIcon className="w-4 h-4 mt-0.5 shrink-0 text-mip-gray-500" />
                    <div className="min-w-0">
                      <dt className="text-[10px] uppercase tracking-wider font-semibold text-mip-gray-500 mb-0.5">
                        When
                      </dt>
                      <dd className="text-mip-gray-900">
                        {badge.weekday}, {badge.month} {badge.day}
                        <br />
                        <span className="text-mip-gray-700">{time}</span>
                      </dd>
                    </div>
                  </div>

                  {resolved.location_text && (
                    <div className="flex items-start gap-3">
                      {resolved.location_type === "online" ? (
                        <Video className="w-4 h-4 mt-0.5 shrink-0 text-mip-gray-500" />
                      ) : (
                        <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-mip-gray-500" />
                      )}
                      <div className="min-w-0">
                        <dt className="text-[10px] uppercase tracking-wider font-semibold text-mip-gray-500 mb-0.5">
                          {resolved.location_type === "online"
                            ? "Online"
                            : resolved.location_type === "hybrid"
                              ? "Hybrid"
                              : "Location"}
                        </dt>
                        <dd className="text-mip-gray-900 break-words">
                          {resolved.location_text}
                        </dd>
                      </div>
                    </div>
                  )}

                  {resolved.cost && (
                    <div className="flex items-start gap-3">
                      <DollarSign className="w-4 h-4 mt-0.5 shrink-0 text-mip-gray-500" />
                      <div>
                        <dt className="text-[10px] uppercase tracking-wider font-semibold text-mip-gray-500 mb-0.5">
                          Cost
                        </dt>
                        <dd className="text-mip-gray-900">{resolved.cost}</dd>
                      </div>
                    </div>
                  )}

                  {resolved.host_org && (
                    <div className="flex items-start gap-3">
                      <Users className="w-4 h-4 mt-0.5 shrink-0 text-mip-gray-500" />
                      <div className="min-w-0">
                        <dt className="text-[10px] uppercase tracking-wider font-semibold text-mip-gray-500 mb-0.5">
                          Hosted by
                        </dt>
                        <dd className="text-mip-gray-900 break-words">
                          {resolved.host_org}
                        </dd>
                      </div>
                    </div>
                  )}
                </dl>

                {resolved.web_link && (
                  <a
                    href={resolved.web_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 mip-button-text"
                    style={{
                      backgroundColor: "var(--color-mip-purple)",
                      color: "var(--color-mip-white)",
                      borderRadius: "var(--radius-button)",
                    }}
                  >
                    <ExternalLink className="w-4 h-4" />
                    More info / RSVP
                  </a>
                )}
              </div>

              {/* Add to calendar card */}
              <div
                className="border border-mip-gray-200 p-5 bg-white"
                style={{ borderRadius: "var(--radius-button)" }}
              >
                <h3
                  className="mip-nav-text mb-3"
                  style={{ color: "var(--color-mip-purple)" }}
                >
                  Add to calendar
                </h3>
                <div className="space-y-2">
                  <a
                    href={googleCalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center gap-2 px-3 py-2 text-sm border border-mip-gray-300 hover:border-mip-purple transition-colors"
                    style={{ borderRadius: "var(--radius-button)" }}
                  >
                    <CalendarIcon className="w-4 h-4 text-mip-purple" />
                    Add to Google Calendar
                  </a>
                  <a
                    href={icsUrl}
                    className="w-full inline-flex items-center gap-2 px-3 py-2 text-sm border border-mip-gray-300 hover:border-mip-purple transition-colors"
                    style={{ borderRadius: "var(--radius-button)" }}
                  >
                    <Download className="w-4 h-4 text-mip-purple" />
                    Download .ics (Apple / Outlook)
                  </a>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * Build a Google Calendar "add event" URL.
 * Format ref: https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…&details=…&location=…
 */
function buildGoogleCalendarUrl(e: CalendarEvent): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };
  const start = fmt(e.starts_at);
  const end = fmt(
    e.ends_at ??
      new Date(new Date(e.starts_at).getTime() + 60 * 60 * 1000).toISOString()
  );
  // Google Calendar shows the description as plain text — strip HTML.
  const plainDescription = (e.description ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${start}/${end}`,
    details: plainDescription,
    location: e.location_text ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

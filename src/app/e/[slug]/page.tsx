import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Globe, ExternalLink, Star, Calendar as CalendarIcon, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { formatDateBadge, formatTimeRange } from "@/lib/utils";
import { ACCESSIBILITY_LABELS } from "@/lib/types";
import type { AccessibilityFeature, CalendarEvent, OverlayCalendar, EventType } from "@/lib/types";
import { SAMPLE_EVENTS } from "@/lib/sample-data";

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
  const overlay = resolved.overlay_calendar as OverlayCalendar | undefined;
  const eventType = resolved.event_type as EventType | undefined;

  const googleCalUrl = buildGoogleCalendarUrl(resolved);
  const icsUrl = `/e/${slug}/ics`;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <main
        className="flex-1 mx-auto w-full px-6 py-6"
        style={{ maxWidth: "var(--max-width-content)" }}
      >
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-mip-gray-500 hover:text-mip-purple"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to calendar
        </Link>

        <div className="grid md:grid-cols-[1fr_320px] gap-8 mt-4">
          {/* Main column */}
          <article>
            {/* Chips */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
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
                  className="text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1"
                  style={{ color: overlay.color }}
                >
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: overlay.color }}
                  />
                  {overlay.name}
                </span>
              )}
              {eventType && (
                <span className="text-[10px] uppercase tracking-wider font-bold text-mip-gray-700">
                  {eventType.name}
                </span>
              )}
            </div>

            <h1
              className="mip-heading text-3xl md:text-4xl mip-double-underline inline-block pb-1"
              style={{ color: "var(--color-mip-purple)" }}
            >
              {resolved.title}
            </h1>

            {resolved.host_org && (
              <p className="mt-4 text-sm text-mip-gray-700">
                Hosted by <strong>{resolved.host_org}</strong>
              </p>
            )}

            {resolved.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolved.image_url}
                alt=""
                className="mt-6 w-full max-h-96 object-cover"
                style={{ borderRadius: "var(--radius-button)" }}
              />
            )}

            {resolved.description && (
              <div className="mt-6 prose prose-sm max-w-none text-mip-gray-900 whitespace-pre-wrap">
                {resolved.description}
              </div>
            )}

            {resolved.accessibility && resolved.accessibility.length > 0 && (
              <div className="mt-8">
                <h3
                  className="mip-nav-text mb-2"
                  style={{ color: "var(--color-mip-purple)" }}
                >
                  Accessibility
                </h3>
                <div className="flex flex-wrap gap-2">
                  {resolved.accessibility.map((a: AccessibilityFeature) => (
                    <span
                      key={a}
                      className="text-xs px-2 py-1"
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
          <aside className="md:sticky md:top-20 md:self-start space-y-4">
            <div
              className="border border-mip-gray-200 p-4"
              style={{ borderRadius: "var(--radius-button)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="shrink-0 w-14 h-14 flex flex-col items-center justify-center text-center"
                  style={{
                    backgroundColor: "var(--color-mip-purple)",
                    color: "var(--color-mip-white)",
                    borderRadius: "var(--radius-button)",
                  }}
                >
                  <div className="text-[10px] font-bold leading-none">{badge.month}</div>
                  <div className="text-lg font-bold leading-tight">{badge.day}</div>
                  <div className="text-[9px] leading-none opacity-80">{badge.weekday}</div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-mip-gray-900">
                    {badge.weekday}, {badge.month} {badge.day}
                  </div>
                  <div className="text-sm text-mip-gray-700">{time}</div>
                </div>
              </div>

              {resolved.location_text && (
                <div className="mt-4 pt-4 border-t border-mip-gray-200 flex items-start gap-2">
                  <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-mip-gray-500" />
                  <div>
                    <div className="text-xs uppercase tracking-wider font-semibold text-mip-gray-500 mb-0.5">
                      {resolved.location_type === "online"
                        ? "Online"
                        : resolved.location_type === "hybrid"
                          ? "Hybrid"
                          : "In person"}
                    </div>
                    <div className="text-sm text-mip-gray-900">
                      {resolved.location_text}
                    </div>
                  </div>
                </div>
              )}

              {resolved.cost && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wider font-semibold text-mip-gray-500">
                    Cost:
                  </span>
                  <span className="text-sm">{resolved.cost}</span>
                </div>
              )}

              {resolved.web_link && (
                <a
                  href={resolved.web_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2 mip-button-text"
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

            <div
              className="border border-mip-gray-200 p-4"
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

            {resolved.web_link && (
              <div
                className="border border-mip-gray-200 p-4 text-xs"
                style={{ borderRadius: "var(--radius-button)" }}
              >
                <div className="flex items-start gap-2">
                  <Globe className="w-4 h-4 mt-0.5 shrink-0 text-mip-gray-500" />
                  <a
                    href={resolved.web_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-mip-purple underline underline-offset-4 break-all"
                  >
                    {resolved.web_link}
                  </a>
                </div>
              </div>
            )}
          </aside>
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
  const end = fmt(e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 60 * 60 * 1000).toISOString());
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${start}/${end}`,
    details: e.description ?? "",
    location: e.location_text ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

import Link from "next/link";
import { Plus, Calendar, Users, Filter } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EventRow } from "./events/event-row";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const supabase = await createClient();

  const nowIso = new Date().toISOString();
  const [{ data: upcoming }, { data: past }, { count: submissionCount }] =
    await Promise.all([
      supabase
        .from("events")
        .select(
          "id, title, slug, starts_at, ends_at, all_day, timezone, is_featured, status, image_url, overlay_calendar_id, overlay_calendar:overlay_calendars(id, name, slug, color, default_visible, sort_order, description)"
        )
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(50),
      supabase
        .from("events")
        .select(
          "id, title, slug, starts_at, ends_at, all_day, timezone, is_featured, status, image_url, overlay_calendar_id, overlay_calendar:overlay_calendars(id, name, slug, color, default_visible, sort_order, description)"
        )
        .lt("starts_at", nowIso)
        .order("starts_at", { ascending: false })
        .limit(10),
      supabase
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);

  const upcomingEvents = upcoming ?? [];
  const pastEvents = past ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1
            className="mip-heading text-3xl mip-double-underline inline-block pb-1"
            style={{ color: "var(--color-mip-purple)" }}
          >
            Events
          </h1>
          <p className="mt-3 text-sm text-mip-gray-700">
            Create, edit, and feature events on the public calendar.
          </p>
        </div>
        <Link
          href="/admin/events/new"
          className="inline-flex items-center gap-2 px-4 py-2 mip-button-text"
          style={{
            backgroundColor: "var(--color-mip-purple)",
            color: "var(--color-mip-white)",
            borderRadius: "var(--radius-button)",
          }}
        >
          <Plus className="w-4 h-4" />
          New Event
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Calendar className="w-4 h-4" />}
          label="Upcoming"
          value={upcomingEvents.length}
          href="#upcoming"
        />
        <StatCard
          icon={<Users className="w-4 h-4" />}
          label="Pending submissions"
          value={submissionCount ?? 0}
          href="/admin/submissions"
          highlight={(submissionCount ?? 0) > 0}
        />
        <StatCard
          icon={<Filter className="w-4 h-4" />}
          label="Overlay calendars"
          value={8}
          href="/admin/overlays"
        />
        <StatCard
          icon={<Calendar className="w-4 h-4" />}
          label="Recent past"
          value={pastEvents.length}
          href="#past"
        />
      </div>

      <section id="upcoming">
        <h2 className="mip-heading text-lg mb-3" style={{ color: "var(--color-mip-purple)" }}>
          Upcoming ({upcomingEvents.length})
        </h2>
        {upcomingEvents.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="border border-mip-gray-200" style={{ borderRadius: "var(--radius-button)" }}>
            {upcomingEvents.map((e, i) => (
              <EventRow
                key={e.id}
                event={e as never}
                isLast={i === upcomingEvents.length - 1}
              />
            ))}
          </div>
        )}
      </section>

      {pastEvents.length > 0 && (
        <section id="past">
          <h2 className="mip-heading text-lg mb-3 text-mip-gray-500">
            Recent past ({pastEvents.length})
          </h2>
          <div className="border border-mip-gray-200 opacity-70" style={{ borderRadius: "var(--radius-button)" }}>
            {pastEvents.map((e, i) => (
              <EventRow
                key={e.id}
                event={e as never}
                isLast={i === pastEvents.length - 1}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  href,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className="block p-4 border transition-colors hover:border-mip-purple"
      style={{
        borderRadius: "var(--radius-button)",
        borderColor: highlight ? "var(--color-mip-purple)" : "var(--color-mip-gray-200)",
        backgroundColor: highlight ? "var(--color-mip-yellow)" : undefined,
      }}
    >
      <div className="flex items-center gap-2 text-xs text-mip-gray-700">
        {icon}
        <span className="uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div
        className="mt-2 mip-heading text-2xl"
        style={{ color: "var(--color-mip-purple)" }}
      >
        {value}
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-mip-gray-300 p-8 text-center" style={{ borderRadius: "var(--radius-button)" }}>
      <p className="text-sm text-mip-gray-700">
        No upcoming events yet.{" "}
        <Link
          href="/admin/events/new"
          className="text-mip-purple underline underline-offset-4"
        >
          Create your first event
        </Link>
        .
      </p>
    </div>
  );
}

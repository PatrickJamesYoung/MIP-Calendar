import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EventForm } from "../../event-form";
import { updateEventAction } from "../../actions";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditEventPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: event }, { data: overlays }, { data: eventTypes }] = await Promise.all([
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
    supabase.from("overlay_calendars").select("*").order("sort_order"),
    supabase.from("event_types").select("*").order("sort_order"),
  ]);

  if (!event) notFound();

  const bound = updateEventAction.bind(null, id);

  return (
    <div>
      <Link
        href="/admin"
        className="text-xs text-mip-gray-500 hover:text-mip-purple"
      >
        ← Back to events
      </Link>
      <h1
        className="mt-2 mip-heading text-2xl mip-double-underline inline-block pb-1"
        style={{ color: "var(--color-mip-purple)" }}
      >
        Edit Event
      </h1>
      <p className="mt-3 mb-6 text-sm text-mip-gray-700 truncate">
        {event.title}
      </p>

      <EventForm
        mode="edit"
        event={event}
        overlays={overlays ?? []}
        eventTypes={eventTypes ?? []}
        action={bound}
      />
    </div>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EventForm } from "../event-form";
import { createEventAction } from "../actions";

export default async function NewEventPage() {
  const supabase = await createClient();
  const [{ data: overlays }, { data: eventTypes }] = await Promise.all([
    supabase.from("overlay_calendars").select("*").order("sort_order"),
    supabase.from("event_types").select("*").order("sort_order"),
  ]);

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
        New Event
      </h1>
      <p className="mt-3 mb-6 text-sm text-mip-gray-700">
        Fill in the details. You can edit or delete later.
      </p>

      <EventForm
        mode="create"
        overlays={overlays ?? []}
        eventTypes={eventTypes ?? []}
        action={createEventAction}
      />
    </div>
  );
}

import { redirect } from "next/navigation";

/**
 * Admin landing.
 *
 * Historically this rendered the events dashboard. Now that the admin
 * console covers Calendar, Gear, Wiki, and Admin sections, we default
 * to the Wiki since it's the shared workspace for the team. The old
 * events dashboard now lives at /admin/events.
 */
export default function AdminIndex() {
  redirect("/admin/wiki");
}

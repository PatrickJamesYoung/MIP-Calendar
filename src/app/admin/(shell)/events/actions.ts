"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AccessibilityFeature } from "@/lib/types";

const ACCESSIBILITY_VALUES = [
  "asl",
  "childcare",
  "captioning",
  "physical_access",
  "elder_seating",
  "spanish",
  "other",
] as const;

const eventSchema = z.object({
  title: z.string().min(1, "Title required").max(300),
  description: z.string().optional().nullable(),
  starts_at: z.string().min(1, "Start date required"),
  ends_at: z.string().optional().nullable(),
  all_day: z.boolean().default(false),
  timezone: z.string().default("America/New_York"),
  location_type: z.enum(["in_person", "online", "hybrid"]).optional().nullable(),
  location_text: z.string().optional().nullable(),
  image_url: z.string().url().optional().nullable().or(z.literal("")),
  event_type_id: z.string().uuid().optional().nullable(),
  cost: z.string().optional().nullable(),
  host_org: z.string().optional().nullable(),
  accessibility: z.array(z.enum(ACCESSIBILITY_VALUES)).default([]),
  web_link: z.string().url().optional().nullable().or(z.literal("")),
  overlay_calendar_id: z.string().uuid().optional().nullable(),
  is_featured: z.boolean().default(false),
  featured_until: z.string().optional().nullable(),
  featured_sort_order: z.number().int().optional().nullable(),
  status: z
    .enum(["published", "pending", "rejected", "archived", "draft"])
    .default("published"),
});

export type EventFormValues = z.infer<typeof eventSchema>;

/**
 * Turn FormData from an <form> POST into a validated event payload.
 * Handles checkbox arrays, empty strings → null, and boolean coercion.
 */
function parseFormData(formData: FormData): EventFormValues {
  const raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;

  const accessibility = formData.getAll("accessibility") as AccessibilityFeature[];
  const cleaned = {
    ...raw,
    accessibility,
    all_day: raw.all_day === "on" || raw.all_day === true,
    is_featured: raw.is_featured === "on" || raw.is_featured === true,
    // Empty string → null for nullable text fields
    description: raw.description || null,
    ends_at: raw.ends_at || null,
    location_type: raw.location_type || null,
    location_text: raw.location_text || null,
    image_url: raw.image_url || null,
    event_type_id: raw.event_type_id || null,
    cost: raw.cost || null,
    host_org: raw.host_org || null,
    web_link: raw.web_link || null,
    overlay_calendar_id: raw.overlay_calendar_id || null,
    featured_until: raw.featured_until || null,
    featured_sort_order:
      raw.featured_sort_order !== "" && raw.featured_sort_order != null
        ? Number(raw.featured_sort_order)
        : null,
  };

  return eventSchema.parse(cleaned);
}

/** HTML datetime-local (`2026-07-14T13:30`) → ISO with the event's TZ offset. */
function localToUtcISO(local: string | null, tz: string): string | null {
  if (!local) return null;
  // Interpret the local string as wall-clock time in `tz`, convert to UTC.
  // Cheap approach: use Date with the tz offset from Intl.
  const dt = new Date(local);
  if (isNaN(dt.getTime())) return null;
  // For simplicity, treat browser-local as America/New_York.
  // We'll refine this once we add proper client-side tz pickers.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(local)).map((p) => [p.type, p.value])
  );
  // The browser passed us a naive local string. We reconstruct it as if
  // it were entered in `tz`.
  const isoLocal = `${local}:00`;
  // Compute offset in ms between UTC and the target tz at that instant.
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = asUTC - dt.getTime();
  const utc = new Date(new Date(isoLocal).getTime() - offsetMs);
  return utc.toISOString();
}

async function logAudit(
  adminId: string,
  action: string,
  entityId: string | null,
  diff: unknown
) {
  const supabase = await createClient();
  await supabase.from("audit_log").insert({
    admin_id: adminId,
    action,
    entity_type: "event",
    entity_id: entityId,
    diff: diff as never,
  });
}

export async function createEventAction(formData: FormData) {
  const admin = await requireAdmin();
  const values = parseFormData(formData);
  const supabase = await createClient();

  const payload = {
    ...values,
    starts_at: localToUtcISO(values.starts_at, values.timezone)!,
    ends_at: localToUtcISO(values.ends_at ?? null, values.timezone),
    featured_until: values.featured_until
      ? localToUtcISO(values.featured_until, values.timezone)
      : null,
    source: "admin" as const,
    created_by: admin.id,
  };

  const { data, error } = await supabase
    .from("events")
    .insert(payload)
    .select("id, slug")
    .single();

  if (error) throw new Error(error.message);

  await logAudit(admin.id, "create", data.id, { after: payload });

  revalidatePath("/admin");
  revalidatePath("/");
  redirect("/admin");
}

export async function updateEventAction(id: string, formData: FormData) {
  const admin = await requireAdmin();
  const values = parseFormData(formData);
  const supabase = await createClient();

  // Snapshot the before-state for the audit log.
  const { data: before } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .single();

  const payload = {
    ...values,
    starts_at: localToUtcISO(values.starts_at, values.timezone)!,
    ends_at: localToUtcISO(values.ends_at ?? null, values.timezone),
    featured_until: values.featured_until
      ? localToUtcISO(values.featured_until, values.timezone)
      : null,
  };

  const { error } = await supabase.from("events").update(payload).eq("id", id);
  if (error) throw new Error(error.message);

  await logAudit(admin.id, "update", id, { before, after: payload });

  revalidatePath("/admin");
  revalidatePath("/");
  redirect("/admin");
}

export async function deleteEventAction(id: string) {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const { data: before } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logAudit(admin.id, "delete", id, { before });

  revalidatePath("/admin");
  revalidatePath("/");
}

export async function toggleFeaturedAction(id: string, isFeatured: boolean) {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("events")
    .update({ is_featured: isFeatured })
    .eq("id", id);

  if (error) throw new Error(error.message);

  await logAudit(admin.id, isFeatured ? "feature" : "unfeature", id, {
    is_featured: isFeatured,
  });

  revalidatePath("/admin");
  revalidatePath("/");
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  emailSubmitterApproved,
  emailSubmitterRejected,
} from "@/lib/email";

/**
 * Slugify a title into a URL-safe string; used when creating an event from
 * a submission. Similar to Trumba import's slugify but simpler — we don't
 * have external_id to fall back on, so we suffix with the submission id.
 */
function slugify(title: string, submissionId: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const suffix = submissionId.replace(/-/g, "").slice(0, 6);
  return base ? `${base}-${suffix}` : `event-${suffix}`;
}

const eventPayloadSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  all_day: z.boolean(),
  timezone: z.string(),
  location_text: z.string().nullable(),
  location_type: z.enum(["in_person", "online", "hybrid"]).nullable(),
  cost: z.string().nullable(),
  host_org: z.string().nullable(),
  web_link: z.string().nullable(),
  image_url: z.string().nullable(),
  overlay_calendar_id: z.string().nullable(),
  event_type_id: z.string().nullable(),
  accessibility: z.array(z.string()),
});

export async function approveSubmissionAction(
  submissionId: string
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorized" };
  }
  const supabase = createAdminClient();

  // Load submission
  const { data: sub, error: subErr } = await supabase
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .single();
  if (subErr || !sub) {
    return { ok: false, error: `Submission not found: ${subErr?.message ?? ""}` };
  }
  if (sub.status !== "pending") {
    return { ok: false, error: `Already ${sub.status}` };
  }

  // Parse payload
  const parsed = eventPayloadSchema.safeParse(sub.event_payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Payload invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    };
  }
  const p = parsed.data;

  // Uniquify slug
  const slug = slugify(p.title, submissionId);

  // Create event
  const { data: newEvent, error: eventErr } = await supabase
    .from("events")
    .insert({
      title: p.title,
      slug,
      description: p.description,
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      all_day: p.all_day,
      timezone: p.timezone,
      location_text: p.location_text,
      location_type: p.location_type,
      cost: p.cost,
      host_org: p.host_org,
      web_link: p.web_link,
      image_url: p.image_url,
      overlay_calendar_id: p.overlay_calendar_id,
      event_type_id: p.event_type_id,
      accessibility: p.accessibility,
      status: "published",
      source: "submission",
      created_by: admin.id,
    })
    .select("id, slug")
    .single();

  if (eventErr || !newEvent) {
    return { ok: false, error: `Could not create event: ${eventErr?.message ?? ""}` };
  }

  // Mark submission decided
  const { error: updateErr } = await supabase
    .from("submissions")
    .update({
      status: "approved",
      decided_by: admin.id,
      decided_at: new Date().toISOString(),
      published_event_id: newEvent.id,
    })
    .eq("id", submissionId);
  if (updateErr) {
    // Try to roll back the event so we don't have an orphan
    await supabase.from("events").delete().eq("id", newEvent.id);
    return { ok: false, error: `Could not update submission: ${updateErr.message}` };
  }

  // Audit log
  await supabase.from("audit_log").insert({
    admin_id: admin.id,
    action: "approve_submission",
    entity_type: "submission",
    entity_id: submissionId,
    diff: { submission_id: submissionId, published_event_id: newEvent.id },
  });

  // Email submitter (best-effort)
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://mip-calendar.vercel.app";
  emailSubmitterApproved({
    submitterName: sub.submitter_name,
    submitterEmail: sub.submitter_email,
    eventTitle: p.title,
    eventUrl: `${siteUrl}/e/${newEvent.slug}`,
  }).catch((e) => console.error("[approve] email failed", e));

  revalidatePath("/admin/submissions");
  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true, slug: newEvent.slug };
}

export async function rejectSubmissionAction(
  submissionId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return { ok: false, error: "Not authorized" };
  }
  if (!reason || reason.trim().length < 5) {
    return { ok: false, error: "Please provide a reason (at least a few words)." };
  }

  const supabase = createAdminClient();

  const { data: sub, error: subErr } = await supabase
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .single();
  if (subErr || !sub) return { ok: false, error: "Submission not found" };
  if (sub.status !== "pending") return { ok: false, error: `Already ${sub.status}` };

  const { error } = await supabase
    .from("submissions")
    .update({
      status: "rejected",
      admin_notes: reason.trim(),
      decided_by: admin.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", submissionId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("audit_log").insert({
    admin_id: admin.id,
    action: "reject_submission",
    entity_type: "submission",
    entity_id: submissionId,
    diff: { reason: reason.trim() },
  });

  const eventTitle =
    (sub.event_payload as { title?: string })?.title ?? "your event";
  emailSubmitterRejected({
    submitterName: sub.submitter_name,
    submitterEmail: sub.submitter_email,
    eventTitle,
    reason: reason.trim(),
  }).catch((e) => console.error("[reject] email failed", e));

  revalidatePath("/admin/submissions");
  return { ok: true };
}

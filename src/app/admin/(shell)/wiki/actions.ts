"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { wikiPageInputSchema } from "@/lib/wiki/schema";

/**
 * Server actions for the wiki. Every action calls requireAdmin() and relies
 * on RLS to enforce that admins can read/write. The DB trigger writes a
 * wiki_page_versions row on every save, so we don't need to record history
 * from the app layer.
 */

export type ActionState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function parseInput(formData: FormData) {
  const raw = {
    title: String(formData.get("title") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    summary: String(formData.get("summary") ?? ""),
    body_md: String(formData.get("body_md") ?? ""),
  };
  return wikiPageInputSchema.safeParse(raw);
}

function flattenZodErrors(
  issues: { path: PropertyKey[]; message: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map((p) => String(p)).join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

// ---------- CREATE ----------

export async function createPage(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = parseInput(formData);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: flattenZodErrors(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wiki_pages")
    .insert({
      title: parsed.data.title,
      slug: parsed.data.slug,
      summary: parsed.data.summary,
      body_md: parsed.data.body_md,
      created_by: admin.user_id,
      updated_by: admin.user_id,
    })
    .select("slug")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "A page with that slug already exists.",
        fieldErrors: { slug: "Already in use" },
      };
    }
    return { ok: false, error: `Could not create page: ${error.message}` };
  }

  revalidatePath("/admin/wiki");
  redirect(`/admin/wiki/${data.slug}`);
}

// ---------- UPDATE ----------

export async function updatePage(
  _prev: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const originalSlug = String(formData.get("original_slug") ?? "");
  if (!id || !originalSlug) {
    return { ok: false, error: "Missing page identifier." };
  }

  const parsed = parseInput(formData);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: flattenZodErrors(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wiki_pages")
    .update({
      title: parsed.data.title,
      slug: parsed.data.slug,
      summary: parsed.data.summary,
      body_md: parsed.data.body_md,
      updated_by: admin.user_id,
    })
    .eq("id", id)
    .select("slug")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "A page with that slug already exists.",
        fieldErrors: { slug: "Already in use" },
      };
    }
    return { ok: false, error: `Could not save page: ${error.message}` };
  }

  revalidatePath("/admin/wiki");
  revalidatePath(`/admin/wiki/${originalSlug}`);
  if (data.slug !== originalSlug) {
    revalidatePath(`/admin/wiki/${data.slug}`);
    redirect(`/admin/wiki/${data.slug}`);
  }
  redirect(`/admin/wiki/${data.slug}`);
}

// ---------- RESTORE VERSION ----------

/**
 * Restore an older version by copying its content into the current
 * wiki_pages row. Does NOT rewrite history — the DB trigger writes a new
 * version pointing at the same body, with the current admin as editor.
 */
export async function restoreVersion(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const pageId = String(formData.get("page_id") ?? "");
  const versionNum = Number(formData.get("version") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!pageId || !Number.isFinite(versionNum) || !slug) {
    throw new Error("Missing page_id, version, or slug");
  }

  const supabase = await createClient();
  const { data: snapshot, error: fetchErr } = await supabase
    .from("wiki_page_versions")
    .select("title,body_md,summary")
    .eq("page_id", pageId)
    .eq("version", versionNum)
    .maybeSingle();

  if (fetchErr || !snapshot) {
    throw new Error("Could not load that version.");
  }

  const { error: updateErr } = await supabase
    .from("wiki_pages")
    .update({
      title: snapshot.title,
      body_md: snapshot.body_md,
      summary: snapshot.summary,
      updated_by: admin.user_id,
    })
    .eq("id", pageId);

  if (updateErr) {
    throw new Error(`Could not restore version: ${updateErr.message}`);
  }

  revalidatePath(`/admin/wiki/${slug}`);
  revalidatePath(`/admin/wiki/${slug}/history`);
  redirect(`/admin/wiki/${slug}`);
}

// ---------- PIN / UNPIN ----------

/**
 * Toggle the pinned state of a wiki page.
 *
 * Pinning stamps `pinned_at = now()`; unpinning nulls it. The index page
 * uses `pinned_at desc` as the sort key, so the most recently pinned
 * page appears first in the pinned section.
 */
export async function togglePinPage(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const pin = formData.get("pin") === "1";
  if (!id) throw new Error("Missing page id");

  const supabase = await createClient();
  const { error } = await supabase
    .from("wiki_pages")
    .update({ pinned_at: pin ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) throw new Error(`Could not update pin: ${error.message}`);

  revalidatePath("/admin/wiki");
}

// ---------- DELETE ----------

export async function deletePage(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing page id");

  const supabase = await createClient();
  const { error } = await supabase.from("wiki_pages").delete().eq("id", id);
  if (error) throw new Error(`Could not delete page: ${error.message}`);

  revalidatePath("/admin/wiki");
  redirect("/admin/wiki");
}

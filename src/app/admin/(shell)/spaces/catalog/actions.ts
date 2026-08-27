"use server";

import { adminFormAction } from "@/lib/admin/action";
import { requireAdmin } from "@/lib/auth";
import { uploadSpaceImage } from "@/lib/spaces-storage";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function stringField(
  form: FormData,
  key: string,
  opts?: { max?: number }
): string | null {
  if (!form.has(key)) return null;
  const raw = String(form.get(key) ?? "").trim();
  if (raw === "") return null;
  return opts?.max ? raw.slice(0, opts.max) : raw;
}

function requiredString(form: FormData, key: string, label: string): string {
  const v = stringField(form, key);
  if (!v) throw new Error(`${label} is required`);
  return v;
}

function numberField(
  form: FormData,
  key: string,
  opts: { min?: number; max?: number } = {}
): number | null {
  if (!form.has(key)) return null;
  const raw = String(form.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  if (opts.min !== undefined && n < opts.min)
    throw new Error(`${key} must be ≥ ${opts.min}`);
  if (opts.max !== undefined && n > opts.max)
    throw new Error(`${key} must be ≤ ${opts.max}`);
  return n;
}

export const createSpace = adminFormAction(
  async ({ supabase }, formData) => {
    const name = requiredString(formData, "name", "Name");
    const slug = stringField(formData, "slug") ?? slugify(name);

    const patch = {
      name,
      slug,
      category: stringField(formData, "category"),
      capacity: numberField(formData, "capacity", { min: 0 }),
      suggested_contribution_per_hour:
        numberField(formData, "suggested_contribution_per_hour", { min: 0 }) ?? 0,
      short_description: stringField(formData, "short_description", { max: 400 }),
      how_to_use_url: stringField(formData, "how_to_use_url"),
      photo_url: stringField(formData, "photo_url"),
      active: formData.get("active") === "on",
      sort_order: numberField(formData, "sort_order", { min: 0 }) ?? 0,
    };

    const { error } = await supabase.from("spaces").insert(patch);
    if (error) throw new Error(`Failed to create space: ${error.message}`);
  },
  {
    name: "createSpace",
    revalidate: "/admin/spaces/catalog",
    audit: (formData) => ({
      action: "space.create",
      entityType: "space",
      diff: {
        slug: stringField(formData, "slug"),
        name: stringField(formData, "name"),
      },
    }),
  }
);

export const updateSpace = adminFormAction(
  async ({ supabase }, formData) => {
    const id = requiredString(formData, "id", "id");

    const patch: Record<string, unknown> = {};
    const stringFields: [string, { max?: number } | undefined][] = [
      ["name", undefined],
      ["slug", undefined],
      ["category", undefined],
      ["short_description", { max: 400 }],
      ["how_to_use_url", undefined],
      ["photo_url", undefined],
    ];
    for (const [f, opts] of stringFields) {
      if (formData.has(f)) patch[f] = stringField(formData, f, opts);
    }
    if (formData.has("capacity"))
      patch.capacity = numberField(formData, "capacity", { min: 0 });
    if (formData.has("suggested_contribution_per_hour"))
      patch.suggested_contribution_per_hour =
        numberField(formData, "suggested_contribution_per_hour", { min: 0 }) ?? 0;
    if (formData.has("sort_order"))
      patch.sort_order = numberField(formData, "sort_order", { min: 0 }) ?? 0;
    patch.active = formData.get("active") === "on";
    patch.updated_at = new Date().toISOString();

    const { error } = await supabase.from("spaces").update(patch).eq("id", id);
    if (error) throw new Error(`Failed to update space: ${error.message}`);
  },
  {
    name: "updateSpace",
    revalidate: "/admin/spaces/catalog",
    audit: (formData) => ({
      action: "space.update",
      entityType: "space",
      entityId: stringField(formData, "id"),
    }),
  }
);

export const toggleSpaceActive = adminFormAction(
  async ({ supabase }, formData) => {
    const id = requiredString(formData, "id", "id");
    const nextActive = formData.get("next_active") === "true";

    const { error } = await supabase
      .from("spaces")
      .update({ active: nextActive, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Failed to toggle space: ${error.message}`);
  },
  {
    name: "toggleSpaceActive",
    revalidate: "/admin/spaces/catalog",
    audit: (formData) => ({
      action: "space.toggle_active",
      entityType: "space",
      entityId: stringField(formData, "id"),
      diff: { next_active: formData.get("next_active") === "true" },
    }),
  }
);

export const deleteSpace = adminFormAction(
  async ({ supabase }, formData) => {
    const id = requiredString(formData, "id", "id");
    const { error } = await supabase.from("spaces").delete().eq("id", id);
    if (error) throw new Error(`Failed to delete space: ${error.message}`);
  },
  {
    name: "deleteSpace",
    revalidate: "/admin/spaces/catalog",
    audit: (formData) => ({
      action: "space.delete",
      entityType: "space",
      entityId: stringField(formData, "id"),
    }),
  }
);

export type UploadSpaceImageResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function uploadSpaceImageAction(
  _prev: UploadSpaceImageResult | null,
  formData: FormData
): Promise<UploadSpaceImageResult> {
  try {
    await requireAdmin();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "No file selected." };
    }
    if (file.size > 5 * 1024 * 1024) {
      return { ok: false, error: "Image is larger than 5\u00A0MB." };
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      return {
        ok: false,
        error: "Unsupported file type. Use JPG, PNG, WEBP, or GIF.",
      };
    }
    const scope =
      (formData.get("slug") as string | null)?.trim() ||
      (formData.get("name") as string | null)?.trim() ||
      "upload";
    const url = await uploadSpaceImage(file, scope);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

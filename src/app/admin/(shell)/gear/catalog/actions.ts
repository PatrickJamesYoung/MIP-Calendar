"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_UNITS = ["per_event", "per_day"] as const;
type Unit = (typeof ALLOWED_UNITS)[number];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function stringField(form: FormData, key: string, opts?: { max?: number }): string | null {
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

function numberField(form: FormData, key: string, opts: { min?: number; max?: number } = {}): number | null {
  if (!form.has(key)) return null;
  const raw = String(form.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  if (opts.min !== undefined && n < opts.min) throw new Error(`${key} must be ≥ ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new Error(`${key} must be ≤ ${opts.max}`);
  return n;
}

function unitField(form: FormData): Unit {
  const raw = String(form.get("unit") ?? "per_event").trim();
  if (!(ALLOWED_UNITS as readonly string[]).includes(raw)) {
    throw new Error(`unit must be one of: ${ALLOWED_UNITS.join(", ")}`);
  }
  return raw as Unit;
}

export async function createGearItem(formData: FormData) {
  await requireAdmin();
  const supabase = createAdminClient();

  const name = requiredString(formData, "name", "Name");
  const slug = stringField(formData, "slug") ?? slugify(name);
  const quantity_total = numberField(formData, "quantity_total", { min: 0 }) ?? 1;
  const suggested_contribution =
    numberField(formData, "suggested_contribution", { min: 0 }) ?? 0;

  const patch = {
    name,
    slug,
    category: stringField(formData, "category"),
    quantity_total,
    suggested_contribution,
    unit: unitField(formData),
    short_description: stringField(formData, "short_description", { max: 400 }),
    how_to_use_url: stringField(formData, "how_to_use_url"),
    photo_url: stringField(formData, "photo_url"),
    active: formData.get("active") === "on",
    sort_order: numberField(formData, "sort_order", { min: 0 }) ?? 0,
    follow_up_question: stringField(formData, "follow_up_question", { max: 500 }),
    requires_electricity: formData.get("requires_electricity") === "on",
  };

  const { error } = await supabase.from("gear_items").insert(patch);
  if (error) throw new Error(`Failed to create item: ${error.message}`);

  revalidatePath("/admin/gear/catalog");
}

export async function updateGearItem(formData: FormData) {
  await requireAdmin();
  const id = requiredString(formData, "id", "id");
  const supabase = createAdminClient();

  const patch: Record<string, unknown> = {};
  const stringFields: [string, { max?: number } | undefined][] = [
    ["name", undefined],
    ["slug", undefined],
    ["category", undefined],
    ["short_description", { max: 400 }],
    ["how_to_use_url", undefined],
    ["photo_url", undefined],
    ["follow_up_question", { max: 500 }],
  ];
  for (const [f, opts] of stringFields) {
    if (formData.has(f)) patch[f] = stringField(formData, f, opts);
  }
  if (formData.has("quantity_total"))
    patch.quantity_total = numberField(formData, "quantity_total", { min: 0 }) ?? 1;
  if (formData.has("suggested_contribution"))
    patch.suggested_contribution =
      numberField(formData, "suggested_contribution", { min: 0 }) ?? 0;
  if (formData.has("unit")) patch.unit = unitField(formData);
  if (formData.has("sort_order"))
    patch.sort_order = numberField(formData, "sort_order", { min: 0 }) ?? 0;
  // Checkboxes: absent = false, "on" = true. Include every time so the form
  // can uncheck as well as check.
  patch.active = formData.get("active") === "on";
  patch.requires_electricity = formData.get("requires_electricity") === "on";
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase.from("gear_items").update(patch).eq("id", id);
  if (error) throw new Error(`Failed to update item: ${error.message}`);

  revalidatePath("/admin/gear/catalog");
}

export async function toggleGearItemActive(formData: FormData) {
  await requireAdmin();
  const id = requiredString(formData, "id", "id");
  const nextActive = formData.get("next_active") === "true";
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("gear_items")
    .update({ active: nextActive, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Failed to toggle item: ${error.message}`);

  revalidatePath("/admin/gear/catalog");
}

export async function deleteGearItem(formData: FormData) {
  await requireAdmin();
  const id = requiredString(formData, "id", "id");
  const supabase = createAdminClient();

  const { error } = await supabase.from("gear_items").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete item: ${error.message}`);

  revalidatePath("/admin/gear/catalog");
}

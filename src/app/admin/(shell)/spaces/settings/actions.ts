"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { KNOWN_SPACE_SETTINGS, type SpaceSettingType } from "./schema";

/**
 * Save any subset of spaces_settings. Only form entries with the
 * "key:<setting_key>" prefix are considered. Values are coerced by
 * declared type before being upserted as jsonb.
 */
export async function saveSpaceSettings(formData: FormData) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const updates: { key: string; value: unknown }[] = [];
  const errors: string[] = [];

  // Collect one entry per key. Checkbox fields pair a hidden "false"
  // with a checkbox "true", so we need every value for a key and pick
  // the winning one per type: booleans take the last (checked wins),
  // everything else takes the last non-empty submission.
  const seen = new Set<string>();
  const keys = Array.from(formData.keys());
  for (const formKey of keys) {
    if (!formKey.startsWith("key:")) continue;
    if (seen.has(formKey)) continue;
    seen.add(formKey);
    const settingKey = formKey.slice(4);
    const declaredType: SpaceSettingType =
      KNOWN_SPACE_SETTINGS.find((s) => s.key === settingKey)?.type ?? "string";
    const values = formData
      .getAll(formKey)
      .map((v) => String(v ?? ""));
    const raw =
      declaredType === "boolean"
        ? values.includes("true")
          ? "true"
          : "false"
        : values[values.length - 1] ?? "";
    try {
      const coerced = coerce(raw, declaredType);
      updates.push({ key: settingKey, value: coerced });
    } catch (e) {
      errors.push(`${settingKey}: ${(e as Error).message}`);
    }
  }

  if (errors.length) {
    throw new Error(
      `Some settings couldn't be saved:\n- ${errors.join("\n- ")}`
    );
  }
  if (updates.length === 0) return;

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("spaces_settings").upsert(
    updates.map((u) => ({
      key: u.key,
      value: u.value,
      updated_at: nowIso,
      updated_by: admin.id,
    })),
    { onConflict: "key" }
  );
  if (error) throw new Error(`Failed to save settings: ${error.message}`);

  revalidatePath("/admin/spaces/settings");
}

function coerce(raw: string, type: SpaceSettingType): unknown {
  const trimmed = raw.trim();
  switch (type) {
    case "string":
      return raw;
    case "boolean":
      return trimmed === "true";
    case "html":
      // Trust the TipTap-produced HTML from the client; it's rendered on
      // the storefront with dangerouslySetInnerHTML, mirroring the wiki
      // page rendering path.
      return raw;
    case "number": {
      if (trimmed === "") return 0;
      const n = Number(trimmed);
      if (!Number.isFinite(n))
        throw new Error(`not a valid number: ${trimmed}`);
      return n;
    }
    case "string_list": {
      // One item per line; trim each line, drop blanks. Stored as a JSON
      // array so it round-trips via jsonb without extra parsing on read.
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }
    default:
      return raw;
  }
}

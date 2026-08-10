"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { KNOWN_SETTINGS, type SettingType } from "./schema";

/**
 * Saves any subset of gear_settings. Only rows whose key matches
 * `key:<setting_key>` in the form are updated. Value coercion depends
 * on the declared type in KNOWN_SETTINGS. Unknown keys fall back to
 * raw-JSON parsing.
 */
export async function saveGearSettings(formData: FormData) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const updates: { key: string; value: unknown }[] = [];
  const errors: string[] = [];

  // Iterate all form keys prefixed with "key:"
  for (const [formKey, formVal] of formData.entries()) {
    if (!formKey.startsWith("key:")) continue;
    const settingKey = formKey.slice(4);
    const declaredType: SettingType =
      KNOWN_SETTINGS.find((s) => s.key === settingKey)?.type ?? "raw";
    const raw = String(formVal ?? "");
    try {
      const coerced = coerce(raw, declaredType);
      updates.push({ key: settingKey, value: coerced });
    } catch (e) {
      errors.push(`${settingKey}: ${(e as Error).message}`);
    }
  }

  if (errors.length) {
    throw new Error(`Some settings couldn't be saved:\n- ${errors.join("\n- ")}`);
  }
  if (updates.length === 0) return;

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("gear_settings").upsert(
    updates.map((u) => ({
      key: u.key,
      value: u.value,
      updated_at: nowIso,
      updated_by: admin.id,
    })),
    { onConflict: "key" }
  );
  if (error) throw new Error(`Failed to save settings: ${error.message}`);

  revalidatePath("/admin/gear/settings");
}

function coerce(raw: string, type: SettingType): unknown {
  const trimmed = raw.trim();
  switch (type) {
    case "string":
      return raw;
    case "number": {
      if (trimmed === "") return 0;
      const n = Number(trimmed);
      if (!Number.isFinite(n)) throw new Error(`not a valid number: ${trimmed}`);
      return n;
    }
    case "email-list": {
      // Split on commas or newlines, trim, drop blanks
      return trimmed
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    case "raw":
    case "json": {
      if (trimmed === "") return null;
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        throw new Error(`invalid JSON: ${(e as Error).message}`);
      }
    }
    default:
      return raw;
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Save subject + body for a single spaces email template. Placeholders and
 * label are managed in the migration, not the UI.
 */
export async function saveSpaceTemplate(formData: FormData) {
  const admin = await requireAdmin();
  const key = String(formData.get("key") ?? "").trim();
  if (!key) throw new Error("Missing template key");

  const subject = String(formData.get("subject") ?? "");
  const body = String(formData.get("body") ?? "");

  if (subject.length > 300) throw new Error("Subject too long (max 300)");
  if (body.length > 20000) throw new Error("Body too long (max 20000)");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("spaces_email_templates")
    .update({
      subject,
      body,
      updated_at: new Date().toISOString(),
      updated_by: admin.id,
    })
    .eq("key", key);
  if (error) throw new Error(`Failed to save template: ${error.message}`);

  revalidatePath("/admin/spaces/templates");
}

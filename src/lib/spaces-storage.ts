import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET_NAME = "spaces-images";

let bucketEnsured = false;

/**
 * Ensure the spaces-images bucket exists. Safe to call repeatedly — caches
 * a boolean after first success. Uses the service role client.
 */
export async function ensureSpacesImagesBucket(): Promise<void> {
  if (bucketEnsured) return;
  const supabase = createAdminClient();
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET_NAME);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    });
    if (error && !error.message.toLowerCase().includes("already exists")) {
      throw new Error(`Failed to create storage bucket: ${error.message}`);
    }
  }
  bucketEnsured = true;
}

/**
 * Upload a file to the spaces-images bucket. Path is scoped by slug.
 */
export async function uploadSpaceImage(
  file: File,
  slugOrScope: string
): Promise<string> {
  await ensureSpacesImagesBucket();
  const supabase = createAdminClient();

  const ext = extensionFromMime(file.type) ?? "bin";
  const scope =
    slugOrScope
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "misc";
  const path = `spaces/${scope}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
  return data.publicUrl;
}

function extensionFromMime(mime: string): string | null {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return null;
  }
}

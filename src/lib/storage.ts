import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET_NAME = "event-images";

let bucketEnsured = false;

/**
 * Ensure the event-images bucket exists. Safe to call repeatedly — caches
 * a boolean after first success. Uses the service role client.
 */
export async function ensureEventImagesBucket(): Promise<void> {
  if (bucketEnsured) return;
  const supabase = createAdminClient();
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET_NAME);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024, // 5 MB
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    });
    if (error && !error.message.toLowerCase().includes("already exists")) {
      throw new Error(`Failed to create storage bucket: ${error.message}`);
    }
  }
  bucketEnsured = true;
}

/**
 * Upload a file to the event-images bucket at a submission-scoped path.
 * Returns the public URL. Throws on failure.
 */
export async function uploadSubmissionImage(
  file: File,
  submissionId: string
): Promise<string> {
  await ensureEventImagesBucket();
  const supabase = createAdminClient();

  const ext = extensionFromMime(file.type) ?? "bin";
  const path = `submissions/${submissionId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(`Image upload failed: ${error.message}`);
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

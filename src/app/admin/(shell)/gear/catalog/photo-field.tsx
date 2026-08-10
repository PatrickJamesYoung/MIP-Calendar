"use client";

import { useRef, useState, useTransition } from "react";
import { uploadGearImageAction } from "./actions";

/**
 * Combined "Photo URL" + "Upload image" field for the gear catalog admin.
 *
 * The `photo_url` text input remains the source of truth submitted with
 * the main create/update form. Uploading a file runs a separate server
 * action that stores the image in Supabase Storage and returns a public
 * URL, which is written back into the text input.
 */
export function PhotoField({
  defaultValue,
  className,
}: {
  defaultValue?: string | null;
  className?: string;
}) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "error"; message: string } | { kind: "ok" }
  >({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.set("file", file);
    // The slug is set in a sibling input; we grab its current value at
    // submit time so uploads for renamed drafts still land in the right
    // folder.
    const slugInput = (e.target.form?.elements.namedItem(
      "slug"
    ) as HTMLInputElement | null)?.value;
    if (slugInput) formData.set("slug", slugInput);
    const nameInput = (e.target.form?.elements.namedItem(
      "name"
    ) as HTMLInputElement | null)?.value;
    if (nameInput) formData.set("name", nameInput);

    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await uploadGearImageAction(null, formData);
      if (result.ok) {
        setUrl(result.url);
        setStatus({ kind: "ok" });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
      // Reset the file input so re-selecting the same file re-triggers.
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  return (
    <div className={`block text-sm ${className ?? ""}`}>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-mip-gray-500">
        Photo
      </div>
      <div className="flex flex-col gap-2">
        <input
          type="url"
          name="photo_url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="w-full rounded-md border border-mip-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
        />
        <div className="flex items-center gap-3 text-xs text-mip-gray-600">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending}
            className="rounded-md border border-mip-gray-300 bg-white px-3 py-1 text-xs font-medium text-mip-gray-700 hover:bg-mip-gray-50 disabled:opacity-50"
          >
            {isPending ? "Uploading…" : "Upload image"}
          </button>
          <span>or paste a URL above. JPG, PNG, WEBP, GIF up to 5 MB.</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        {status.kind === "error" && (
          <p className="text-xs text-rose-700">{status.message}</p>
        )}
        {status.kind === "ok" && url && (
          <div className="flex items-center gap-2 text-xs text-mip-gray-600">
            <span className="text-emerald-700">Uploaded.</span>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-mip-purple"
            >
              View image
            </a>
          </div>
        )}
        {url && status.kind !== "ok" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className="mt-1 h-20 w-auto rounded border border-mip-gray-200 object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
      </div>
    </div>
  );
}

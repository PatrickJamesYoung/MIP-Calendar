"use client";

import { RotateCcw } from "lucide-react";

/**
 * Client wrapper for the restore server action so we can prompt for
 * confirmation before the form submits. Restore is not destructive —
 * it writes a new version — but the confirm is still useful to prevent
 * accidental submits from a mis-click on a long history page.
 */
export function RestoreVersionButton({
  action,
  pageId,
  slug,
  version,
  title,
}: {
  action: (formData: FormData) => Promise<void>;
  pageId: string;
  slug: string;
  version: number;
  title: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Restore v${version} ("${title}") as the current version? Your latest edits stay in history — this creates a new version copying v${version}'s content.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="page_id" value={pageId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        className="inline-flex items-center gap-2 px-4 py-2 mip-button-text"
        style={{
          backgroundColor: "var(--color-mip-purple)",
          color: "var(--color-mip-white)",
          borderRadius: "var(--radius-button)",
        }}
      >
        <RotateCcw className="w-4 h-4" />
        Restore this version
      </button>
    </form>
  );
}

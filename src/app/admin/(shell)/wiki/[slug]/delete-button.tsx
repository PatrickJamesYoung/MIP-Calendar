"use client";

import { deletePage } from "../actions";

/**
 * Delete confirmation for a wiki page. Renders a native confirm() before the
 * server action fires. Client component so we can intercept the submit event.
 */
export function DeleteWikiPageButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  return (
    <form
      action={deletePage}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete "${title}"? All version history for this page will also be removed.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="inline-flex items-center gap-2 px-4 py-2 mip-button-text border border-mip-gray-300 text-mip-gray-700 hover:bg-mip-gray-100"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        Delete
      </button>
    </form>
  );
}

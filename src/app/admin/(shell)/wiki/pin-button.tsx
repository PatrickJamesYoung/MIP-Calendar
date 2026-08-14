"use client";

import { Pin, PinOff } from "lucide-react";
import { togglePinPage } from "./actions";

/**
 * Small inline button that toggles a page's pinned state.
 *
 * Rendered inside each row on the wiki index. It's a plain form posting
 * to a server action, so it works without JS; we only need "use client"
 * because we call `stopPropagation` to keep clicks from bubbling up
 * into the row-level `<Link>`.
 */
export function PinButton({
  id,
  pinned,
}: {
  id: string;
  pinned: boolean;
}) {
  return (
    <form
      action={togglePinPage}
      onClick={(e) => e.stopPropagation()}
      className="shrink-0"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="pin" value={pinned ? "0" : "1"} />
      <button
        type="submit"
        title={pinned ? "Unpin" : "Pin to top"}
        aria-label={pinned ? "Unpin" : "Pin to top"}
        className={`inline-flex items-center justify-center w-8 h-8 transition-colors ${
          pinned
            ? "text-mip-purple hover:bg-mip-purple/10"
            : "text-mip-gray-400 hover:text-mip-purple hover:bg-mip-gray-100"
        }`}
        style={{ borderRadius: "var(--radius-button)" }}
      >
        {pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
      </button>
    </form>
  );
}

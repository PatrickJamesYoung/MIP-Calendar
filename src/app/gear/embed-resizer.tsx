"use client";

import { useEffect } from "react";

/**
 * Posts the document's current height to window.parent whenever it
 * changes, so a hosting page (e.g. Squarespace iframe) can auto-resize.
 *
 * Protocol: { type: "mip-gear:height", height: <number> }
 *
 * No-op when the page isn't inside an iframe.
 */
export function EmbedResizer() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // window.parent === window when not embedded.
    if (window.parent === window) return;

    let lastHeight = -1;

    const post = () => {
      const h = Math.ceil(
        Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0
        )
      );
      if (h === lastHeight) return;
      lastHeight = h;
      window.parent.postMessage(
        { type: "mip-gear:height", height: h },
        // Any parent origin \u2014 the parent listener is responsible for
        // filtering by event.origin. Using "*" here is standard for
        // embeds hosted on arbitrary domains.
        "*"
      );
    };

    post();
    const observer = new ResizeObserver(post);
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
    // Also re-post on load (images decoding can change layout).
    window.addEventListener("load", post);

    return () => {
      observer.disconnect();
      window.removeEventListener("load", post);
    };
  }, []);

  return null;
}

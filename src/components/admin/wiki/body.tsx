import { WikiHtml } from "./html";
import { WikiMarkdown } from "./markdown";
import { isHtmlContent } from "@/lib/wiki/format";

/**
 * Renders a wiki body, auto-detecting whether it's HTML (from Tiptap) or
 * legacy markdown. Existing markdown pages keep working exactly as before;
 * new pages authored via Tiptap render as HTML.
 */
export function WikiBody({ source }: { source: string }) {
  return isHtmlContent(source) ? (
    <WikiHtml source={source} />
  ) : (
    <WikiMarkdown source={source} />
  );
}

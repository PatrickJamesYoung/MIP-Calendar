/**
 * Detect whether a wiki body was authored as HTML (Tiptap) or legacy
 * markdown. Cheap heuristic: HTML from Tiptap always starts with a
 * block-level tag. Markdown never does — a leading `#`, `-`, or plain
 * word can't be confused with `<p>`, `<h1>`, etc.
 *
 * Edge case handled: leading whitespace before the first tag.
 */
export function isHtmlContent(source: string): boolean {
  return /^\s*<[a-z][a-z0-9]*(\s|>|\/)/i.test(source);
}

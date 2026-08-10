import DOMPurify from "isomorphic-dompurify";

/**
 * Server-rendered HTML for wiki page bodies authored via Tiptap.
 *
 * Sanitized with DOMPurify. We're conservative:
 *   - Strip scripts, event handlers, and javascript: URLs.
 *   - Force target="_blank" + rel="noopener noreferrer" on all anchors.
 *   - Allow the set of tags Tiptap actually emits from our StarterKit +
 *     Link + Table configuration; anything else gets dropped.
 *
 * Even though only admins can author, sanitizing keeps us safe from:
 *   - A future non-admin write path (e.g. import, migration).
 *   - Copy-pasted HTML that admins didn't realize they were pasting.
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "s",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

const ALLOWED_ATTR = ["href", "colspan", "rowspan", "rel", "target"];

export function WikiHtml({ source }: { source: string }) {
  if (!source.trim()) {
    return (
      <p className="text-sm text-mip-gray-500 italic">
        This page is empty. Click Edit to add content.
      </p>
    );
  }

  // DOMPurify hooks: force safe link attributes on every <a>.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const el = node as Element;
      el.setAttribute("rel", "noopener noreferrer");
      const href = el.getAttribute("href") ?? "";
      if (href.startsWith("http")) {
        el.setAttribute("target", "_blank");
      }
    }
  });

  const clean = DOMPurify.sanitize(source, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Belt-and-suspenders: reject any protocol other than http(s), mailto, tel.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });

  // Remove the hook after use so it doesn't leak into other sanitize calls
  // in the same render pass. DOMPurify hooks are process-global.
  DOMPurify.removeAllHooks();

  return (
    <div
      className="wiki-prose"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

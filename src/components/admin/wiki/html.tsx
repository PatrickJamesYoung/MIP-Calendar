import sanitizeHtml from "sanitize-html";

/**
 * Server-rendered HTML for wiki page bodies authored via Tiptap.
 *
 * We use sanitize-html (pure JS, no jsdom) rather than DOMPurify to keep
 * this working in Next.js server components on Vercel without pulling
 * a DOM shim into the serverless bundle.
 *
 * Sanitization policy:
 *   - Allow only the tags Tiptap actually emits (StarterKit + Link + Table).
 *   - Force every <a> to rel="noopener noreferrer" and open external
 *     links in a new tab.
 *   - Restrict URL schemes to http/https/mailto/tel.
 *   - Drop anything else, including scripts and inline event handlers.
 */

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
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

export function WikiHtml({ source }: { source: string }) {
  if (!source.trim()) {
    return (
      <p className="text-sm text-mip-gray-500 italic">
        This page is empty. Click Edit to add content.
      </p>
    );
  }

  const clean = sanitizeHtml(source, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "target", "rel"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href ?? "";
        const isExternal = href.startsWith("http");
        return {
          tagName: "a",
          attribs: {
            href,
            rel: "noopener noreferrer",
            ...(isExternal ? { target: "_blank" } : {}),
          },
        };
      },
    },
  });

  return (
    <div
      className="wiki-prose"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

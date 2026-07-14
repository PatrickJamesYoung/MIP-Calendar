/**
 * Clean and sanitize event descriptions for rendering.
 *
 * Trumba stuffs a preamble into every DESCRIPTION field that duplicates
 * data we already have as structured columns:
 *
 *   Event Type: Arts & Culture,Fundraiser<br>Cost: Donation<br>
 *   Host Organization: 411 Collective x Lulu's Cafe<br>
 *   Link: https://www.instagram.com/p/DY-Sip8kQyE<br><br>
 *   …actual body starts here…
 *
 * We strip that preamble, then run the remainder through DOMPurify so we
 * can safely render Trumba's <br>, <strong>, <em>, <a> markup instead of
 * showing raw tags to the user.
 */
import DOMPurify from "isomorphic-dompurify";

/**
 * Field-name prefixes Trumba auto-prepends to descriptions.
 * We drop everything up to (and including) the first blank line
 * (`<br><br>`) once we've seen at least one such field.
 */
const TRUMBA_FIELD_PREFIXES = [
  "Event Type:",
  "Cost:",
  "Host Organization:",
  "Host:",
  "Link:",
  "Register:",
  "Website:",
  "Sponsor:",
  "Contact:",
  "Presenter:",
  "Presented by:",
  "Speaker:",
  "More info:",
  "RSVP:",
];

/**
 * Strip the Trumba auto-generated preamble from the top of a description.
 *
 * We look for a run of `<br>`-separated lines at the start where each line
 * begins with one of the known field prefixes. As soon as we hit a line
 * that isn't a field prefix (or a blank line separator), we return the
 * rest as the "real" body.
 */
export function stripTrumbaPreamble(html: string): string {
  if (!html) return html;

  // Normalize <br /> / <br/> / <BR> → <br>, then split on <br>. We keep
  // consecutive empty tokens so we can detect blank-line separators.
  const normalized = html.replace(/<br\s*\/?>/gi, "<br>");
  const tokens = normalized.split("<br>");

  let sawField = false;
  let cutIndex = 0;
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const stripped = raw.replace(/<[^>]+>/g, "").trim();

    if (stripped === "") {
      // Blank line — if we already consumed at least one field, this is
      // the end of the preamble. Skip any additional consecutive blanks
      // and stop.
      if (sawField) {
        let j = i;
        while (j < tokens.length && tokens[j].replace(/<[^>]+>/g, "").trim() === "") j++;
        cutIndex = j;
        break;
      }
      // Leading blank before any field — just skip past it.
      cutIndex = i + 1;
      continue;
    }

    const matchesField = TRUMBA_FIELD_PREFIXES.some((p) =>
      stripped.startsWith(p)
    );
    if (matchesField) {
      sawField = true;
      cutIndex = i + 1;
      continue;
    }

    // Non-field, non-blank line — preamble is done. Keep from here.
    break;
  }

  if (!sawField) return html; // no preamble detected — leave content alone

  return tokens.slice(cutIndex).join("<br>");
}

/**
 * Sanitize HTML for safe rendering. Allows a small whitelist of tags that
 * Trumba emits, and forces target="_blank" rel="noopener noreferrer" on
 * all anchors so external links open safely in a new tab.
 */
export function sanitizeDescription(html: string): string {
  if (!html) return "";

  const cleaned = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "a",
      "b",
      "i",
      "u",
      "em",
      "strong",
      "br",
      "p",
      "ul",
      "ol",
      "li",
      "blockquote",
      "h2",
      "h3",
      "h4",
      "hr",
      "code",
      "pre",
      "span",
      "div",
    ],
    ALLOWED_ATTR: ["href", "title", "dir"],
    ALLOW_DATA_ATTR: false,
  });

  // Force target/rel on all <a>. DOMPurify strips target/rel from ALLOWED_ATTR
  // if we don't list them, but adding them back and then post-processing is
  // simpler than a hook — do it with a lightweight string rewrite.
  return cleaned.replace(
    /<a\s+([^>]*?)href="([^"]+)"([^>]*?)>/gi,
    (_m, pre, href, post) => {
      const safeHref = href.startsWith("javascript:") ? "#" : href;
      return `<a ${pre}href="${safeHref}"${post} target="_blank" rel="noopener noreferrer">`;
    }
  );
}

/**
 * Full pipeline: strip Trumba preamble, then sanitize.
 * Returns HTML ready for dangerouslySetInnerHTML.
 */
export function prepareDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  const stripped = stripTrumbaPreamble(raw);
  return sanitizeDescription(stripped);
}

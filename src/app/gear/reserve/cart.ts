/**
 * The cart is carried between /gear and /gear/reserve as a URL query
 * param. Two formats are supported so old bookmarks keep working:
 *
 *   Legacy:  ?items=slug1:2,slug2:1
 *   Current: ?items=slug1:2,slug2:1  (plus optional ?answers=slug1|answer1;slug2|answer2)
 *
 * Follow-up answers are encoded in a separate `answers` param so the
 * item list stays short and readable. Any slug that isn't present in
 * `answers` simply has no captured answer.
 *
 * Keeping this stateless means we don't rely on cookies or
 * localStorage (both blocked in the embed context), and users can
 * bookmark or share a specific cart.
 */

export interface CartEntry {
  slug: string;
  quantity: number;
  followUpAnswer?: string;
}

const MAX_ENTRIES = 40;
const MAX_QTY = 99;
const MAX_ANSWER_LEN = 500;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function parseCart(
  rawItems: string | undefined | null,
  rawAnswers?: string | undefined | null
): CartEntry[] {
  if (!rawItems) return [];

  const answers = parseAnswers(rawAnswers);

  const out: CartEntry[] = [];
  const seen = new Set<string>();
  for (const piece of rawItems.split(",")) {
    if (out.length >= MAX_ENTRIES) break;
    const [slug, qtyStr] = piece.split(":");
    if (!slug) continue;
    const s = slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    const q = Math.max(1, Math.min(MAX_QTY, parseInt(qtyStr ?? "1", 10) || 1));
    const entry: CartEntry = { slug: s, quantity: q };
    const ans = answers.get(s);
    if (ans) entry.followUpAnswer = ans;
    out.push(entry);
  }
  return out;
}

function parseAnswers(
  raw: string | undefined | null
): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const piece of raw.split(";")) {
    const sepIdx = piece.indexOf("|");
    if (sepIdx <= 0) continue;
    const slug = piece.slice(0, sepIdx).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) continue;
    const answer = piece
      .slice(sepIdx + 1)
      .trim()
      .slice(0, MAX_ANSWER_LEN);
    if (!answer) continue;
    map.set(slug, answer);
  }
  return map;
}

export function encodeCart(entries: CartEntry[]): {
  items: string;
  answers: string | null;
} {
  const items = entries
    .map((e) => `${e.slug}:${e.quantity}`)
    .join(",");
  const answers = entries
    .filter((e) => e.followUpAnswer && e.followUpAnswer.trim() !== "")
    .map((e) => `${e.slug}|${e.followUpAnswer!.slice(0, MAX_ANSWER_LEN)}`)
    .join(";");
  return { items, answers: answers || null };
}

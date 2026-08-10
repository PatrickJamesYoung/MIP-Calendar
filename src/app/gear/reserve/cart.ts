/**
 * The cart is carried between /gear and /gear/reserve as a URL query
 * param formatted as: `?items=slug1:2,slug2:1`. Keeping it stateless
 * means we don't rely on cookies or localStorage (both blocked in the
 * embed context), and users can bookmark or share a specific cart.
 */

export interface CartEntry {
  slug: string;
  quantity: number;
}

const MAX_ENTRIES = 40;
const MAX_QTY = 99;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function parseCart(raw: string | undefined | null): CartEntry[] {
  if (!raw) return [];
  const out: CartEntry[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(",")) {
    if (out.length >= MAX_ENTRIES) break;
    const [slug, qtyStr] = piece.split(":");
    if (!slug) continue;
    const s = slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    const q = Math.max(1, Math.min(MAX_QTY, parseInt(qtyStr ?? "1", 10) || 1));
    out.push({ slug: s, quantity: q });
  }
  return out;
}

export function encodeCart(entries: CartEntry[]): string {
  return entries.map((e) => `${e.slug}:${e.quantity}`).join(",");
}

/**
 * Slug utilities for the admin wiki. Slugs are URL-safe kebab-case tokens
 * matching the check constraint on wiki_pages.slug:
 *   ^[a-z0-9]+(?:-[a-z0-9]+)*$
 *
 * We keep this pure (no DB access) so it can run in client components
 * for live slug preview when the user is typing a title.
 */

export const SLUG_MAX_LEN = 80;

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= SLUG_MAX_LEN;
}

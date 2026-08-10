import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";

interface SidebarPage {
  slug: string;
  title: string;
}

/**
 * Left-hand nav shown on individual wiki page routes. Lists every page
 * alphabetically with the current one highlighted. Kept intentionally
 * small — for larger wikis we'd add categories or nesting, but at MIP
 * scale a flat A→Z list is easier to scan.
 */
export function WikiSidebar({
  pages,
  currentSlug,
}: {
  pages: SidebarPage[];
  currentSlug: string;
}) {
  return (
    <aside className="md:sticky md:top-4 self-start">
      <div className="mb-3 flex items-center justify-between">
        <Link
          href="/admin/wiki"
          className="text-xs uppercase tracking-wider text-mip-gray-500 hover:text-mip-gray-900"
        >
          All pages
        </Link>
        <Link
          href="/admin/wiki/new"
          className="inline-flex items-center gap-1 text-xs text-mip-purple hover:underline underline-offset-4"
        >
          <Plus className="w-3 h-3" />
          New
        </Link>
      </div>
      {pages.length === 0 ? (
        <p className="text-xs text-mip-gray-500">No pages yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {pages.map((p) => {
            const active = p.slug === currentSlug;
            return (
              <li key={p.slug}>
                <Link
                  href={`/admin/wiki/${p.slug}`}
                  className={`flex items-center gap-2 px-2 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-mip-purple/10 text-mip-purple mip-heading"
                      : "text-mip-gray-700 hover:bg-mip-gray-100"
                  }`}
                  style={{ borderRadius: "var(--radius-button)" }}
                >
                  <BookOpen
                    className={`w-3.5 h-3.5 shrink-0 ${
                      active ? "text-mip-purple" : "text-mip-gray-400"
                    }`}
                  />
                  <span className="truncate">{p.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

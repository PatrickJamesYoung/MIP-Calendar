import Link from "next/link";
import { Plus, BookOpen, Clock } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface WikiPageRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  updated_at: string;
  /** Only populated when this row came back from wiki_search. */
  snippet?: string;
}

const PAGE_SIZE = 50;

export default async function AdminWikiIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const search = (params.q ?? "").trim();

  const supabase = await createClient();

  // Two code paths:
  //  - No query → plain ordered list from wiki_pages (with exact count).
  //  - Query   → wiki_search RPC, which returns headline snippets and
  //              rank-ordered rows. Count is just rows.length — the RPC
  //              caps at 50, which matches the plain list's PAGE_SIZE, so
  //              a single number is honest here.
  let pages: WikiPageRow[];
  let totalCount: number;

  if (search) {
    const { data } = await supabase.rpc("wiki_search", { q: search });
    pages = (data ?? []) as WikiPageRow[];
    totalCount = pages.length;
  } else {
    const { data, count } = await supabase
      .from("wiki_pages")
      .select("id,slug,title,summary,updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .limit(PAGE_SIZE);
    pages = (data ?? []) as WikiPageRow[];
    totalCount = count ?? pages.length;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1
            className="mip-heading text-3xl mip-double-underline inline-block pb-1"
            style={{ color: "var(--color-mip-purple)" }}
          >
            Wiki
          </h1>
          <p className="mt-3 text-sm text-mip-gray-700">
            Internal knowledge base for MIP admins. Markdown pages with full
            edit history.
          </p>
        </div>
        <Link
          href="/admin/wiki/new"
          className="inline-flex items-center gap-2 px-4 py-2 mip-button-text"
          style={{
            backgroundColor: "var(--color-mip-purple)",
            color: "var(--color-mip-white)",
            borderRadius: "var(--radius-button)",
          }}
        >
          <Plus className="w-4 h-4" />
          New page
        </Link>
      </div>

      {/* Search */}
      <form className="flex items-center gap-2" action="/admin/wiki" method="get">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder='Full-text search — try "foo" phrase, -exclude, or foo OR bar'
          className="flex-1 md:max-w-md px-3 py-1.5 text-sm border border-mip-gray-300 focus:outline-none focus:border-mip-purple"
          style={{ borderRadius: "var(--radius-button)" }}
        />
        <button
          type="submit"
          className="px-3 py-1.5 mip-button-text bg-mip-gray-100 text-mip-gray-700 hover:bg-mip-gray-200"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          Search
        </button>
        {search && (
          <Link
            href="/admin/wiki"
            className="text-xs text-mip-gray-500 hover:text-mip-gray-700 underline"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Results */}
      {pages.length === 0 ? (
        <EmptyState hasSearch={Boolean(search)} />
      ) : (
        <>
          <div className="text-xs uppercase tracking-wider text-mip-gray-500">
            {totalCount} page{totalCount === 1 ? "" : "s"}
          </div>
          <ul
            className="border border-mip-gray-200 divide-y divide-mip-gray-100"
            style={{ borderRadius: "var(--radius-card)" }}
          >
            {pages.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/wiki/${p.slug}`}
                  className="block px-4 py-3 hover:bg-mip-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-mip-purple shrink-0" />
                        <span className="mip-heading text-base truncate">
                          {p.title}
                        </span>
                      </div>
                      {p.snippet ? (
                        // The wiki_search RPC strips HTML tags from bodies
                        // before ts_headline runs, then ts_headline wraps
                        // matches in <b>...</b>. The only markup the client
                        // ever receives is those <b> tags, so this is safe
                        // to render as HTML.
                        <p
                          className="mt-1 text-sm text-mip-gray-700 line-clamp-2 [&_b]:font-bold [&_b]:text-mip-purple"
                          dangerouslySetInnerHTML={{ __html: p.snippet }}
                        />
                      ) : (
                        p.summary && (
                          <p className="mt-1 text-sm text-mip-gray-700 line-clamp-2">
                            {p.summary}
                          </p>
                        )
                      )}
                      <p className="mt-1 text-xs text-mip-gray-500 font-mono">
                        /{p.slug}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-mip-gray-500 shrink-0">
                      <Clock className="w-3 h-3" />
                      {formatRelative(p.updated_at)}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  if (hasSearch) {
    return (
      <div
        className="border border-dashed border-mip-gray-300 p-8 text-center"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <p className="text-sm text-mip-gray-700">
          No pages match your search.
        </p>
      </div>
    );
  }
  return (
    <div
      className="border border-dashed border-mip-gray-300 p-8 text-center"
      style={{ borderRadius: "var(--radius-button)" }}
    >
      <p className="text-sm text-mip-gray-700">
        No wiki pages yet.{" "}
        <Link
          href="/admin/wiki/new"
          className="text-mip-purple underline underline-offset-4"
        >
          Create the first page
        </Link>
        .
      </p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

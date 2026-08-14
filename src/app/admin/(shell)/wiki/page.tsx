import Link from "next/link";
import { Plus, BookOpen, Clock, Pin } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PinButton } from "./pin-button";

export const dynamic = "force-dynamic";

interface WikiPageRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  updated_at: string;
  pinned_at?: string | null;
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

  // Three code paths:
  //  - Search query → wiki_search RPC (rank-ordered, pinning ignored so
  //    relevance wins for that view).
  //  - No search → fetch all pages and split into pinned + recent in JS.
  //    This is one round trip that handles both sections; the wiki
  //    isn't large enough for a second query to be worth it.
  let pinned: WikiPageRow[] = [];
  let recent: WikiPageRow[] = [];
  let searchResults: WikiPageRow[] = [];
  let totalCount = 0;

  if (search) {
    const { data } = await supabase.rpc("wiki_search", { q: search });
    searchResults = (data ?? []) as WikiPageRow[];
    totalCount = searchResults.length;
  } else {
    const { data, count } = await supabase
      .from("wiki_pages")
      .select("id,slug,title,summary,updated_at,pinned_at", { count: "exact" })
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(PAGE_SIZE);
    const rows = (data ?? []) as WikiPageRow[];
    pinned = rows.filter((r) => r.pinned_at);
    recent = rows.filter((r) => !r.pinned_at);
    totalCount = count ?? rows.length;
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
            Internal knowledge base for MIP admins. Pages with full edit
            history — pin the ones people should find first.
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
      {search ? (
        // Search results: single flat list, pinning ignored so ranking wins.
        searchResults.length === 0 ? (
          <EmptyState hasSearch />
        ) : (
          <>
            <SectionHeader
              label={`${totalCount} result${totalCount === 1 ? "" : "s"}`}
            />
            <PageList pages={searchResults} />
          </>
        )
      ) : pinned.length === 0 && recent.length === 0 ? (
        <EmptyState hasSearch={false} />
      ) : (
        <>
          {pinned.length > 0 && (
            <div className="space-y-2">
              <SectionHeader
                label="Pinned"
                icon={<Pin className="w-3 h-3" />}
              />
              <PageList pages={pinned} />
            </div>
          )}
          {recent.length > 0 && (
            <div className="space-y-2">
              <SectionHeader
                label={
                  pinned.length > 0
                    ? "All pages"
                    : `${totalCount} page${totalCount === 1 ? "" : "s"}`
                }
              />
              <PageList pages={recent} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({
  label,
  icon,
}: {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-mip-gray-500">
      {icon}
      {label}
    </div>
  );
}

function PageList({ pages }: { pages: WikiPageRow[] }) {
  return (
    <ul
      className="border border-mip-gray-200 divide-y divide-mip-gray-100"
      style={{ borderRadius: "var(--radius-card)" }}
    >
      {pages.map((p) => (
        <li key={p.id} className="relative group">
          {/* The pin button sits absolutely inside the row so it can post
              its own form without being nested inside the row link (which
              would be invalid HTML: <form> inside <a>). The row link
              takes up the rest of the row via padding-right to leave
              space for the button. */}
          <Link
            href={`/admin/wiki/${p.slug}`}
            className="block px-4 py-3 pr-14 hover:bg-mip-gray-50 transition-colors"
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
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <PinButton id={p.id} pinned={Boolean(p.pinned_at)} />
          </div>
        </li>
      ))}
    </ul>
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

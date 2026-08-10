import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageRow {
  id: string;
  slug: string;
  title: string;
}

interface VersionRow {
  id: string;
  version: number;
  title: string;
  edited_by_email: string | null;
  created_at: string;
  // Body kept out of the list query — it's fetched only on the detail view.
}

export default async function WikiHistoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireAdmin();

  const supabase = await createClient();
  const { data: pageData } = await supabase
    .from("wiki_pages")
    .select("id,slug,title")
    .eq("slug", slug)
    .maybeSingle();

  if (!pageData) return notFound();
  const page = pageData as PageRow;

  const { data: versionData } = await supabase
    .from("wiki_page_versions")
    .select("id,version,title,edited_by_email,created_at")
    .eq("page_id", page.id)
    .order("version", { ascending: false });

  const versions = (versionData ?? []) as VersionRow[];
  const latest = versions[0]?.version ?? null;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link
          href={`/admin/wiki/${page.slug}`}
          className="text-mip-gray-500 hover:text-mip-gray-900"
        >
          ← {page.title}
        </Link>
      </div>

      <div>
        <h1
          className="mip-heading text-2xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          History
        </h1>
        <p className="mt-2 text-sm text-mip-gray-700">
          Every save creates a new version. The most recent one matches the
          live page. Restore an earlier version from its detail view.
        </p>
      </div>

      {versions.length === 0 ? (
        <div
          className="border border-dashed border-mip-gray-300 p-8 text-center"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          <p className="text-sm text-mip-gray-700">
            No versions recorded yet.
          </p>
        </div>
      ) : (
        <ul
          className="border border-mip-gray-200 divide-y divide-mip-gray-100"
          style={{ borderRadius: "var(--radius-card)" }}
        >
          {versions.map((v) => {
            const isLatest = v.version === latest;
            return (
              <li key={v.id}>
                <Link
                  href={`/admin/wiki/${page.slug}/history/${v.version}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-mip-gray-50 transition-colors"
                >
                  <div className="shrink-0 w-16 text-right">
                    <span
                      className="mip-heading text-lg tabular-nums"
                      style={{ color: "var(--color-mip-purple)" }}
                    >
                      v{v.version}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm mip-heading truncate">
                        {v.title}
                      </span>
                      {isLatest && (
                        <span
                          className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5"
                          style={{
                            backgroundColor: "var(--color-mip-purple)",
                            color: "var(--color-mip-white)",
                            borderRadius: "var(--radius-button)",
                          }}
                        >
                          Current
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-mip-gray-500">
                      <Clock className="w-3 h-3" />
                      {new Date(v.created_at).toLocaleString()}
                      {v.edited_by_email && <> · {v.edited_by_email}</>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-mip-gray-400 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

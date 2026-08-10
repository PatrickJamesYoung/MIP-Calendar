import type { ReactNode } from "react";
import { WikiSidebar } from "@/components/admin/wiki/sidebar";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Layout for a single wiki page and its sub-routes (view, edit, history,
 * history/[version]). Provides a left-hand nav of all pages so admins can
 * jump between pages without hitting /admin/wiki first.
 *
 * The index (/admin/wiki) has its own search UI and doesn't need this
 * sidebar, and /admin/wiki/new is a full-width form — both stay outside
 * this layout.
 */
export default async function WikiPageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireAdmin();

  const supabase = await createClient();
  const { data } = await supabase
    .from("wiki_pages")
    .select("slug,title")
    .order("title", { ascending: true });

  const pages = (data ?? []) as { slug: string; title: string }[];

  return (
    <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
      <WikiSidebar pages={pages} currentSlug={slug} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

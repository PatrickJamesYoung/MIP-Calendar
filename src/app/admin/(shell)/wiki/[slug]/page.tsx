import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Clock } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WikiMarkdown } from "@/components/admin/wiki/markdown";
import { DeleteWikiPageButton } from "./delete-button";

export const dynamic = "force-dynamic";

interface WikiPageRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  updated_at: string;
  updated_by: string | null;
}

export default async function WikiViewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireAdmin();

  const supabase = await createClient();
  const { data } = await supabase
    .from("wiki_pages")
    .select("id,slug,title,summary,body_md,updated_at,updated_by")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) return notFound();
  const page = data as WikiPageRow;

  // Best-effort: resolve updater email from admins table.
  let updatedByEmail: string | null = null;
  if (page.updated_by) {
    const { data: adminRow } = await supabase
      .from("admins")
      .select("email")
      .eq("user_id", page.updated_by)
      .maybeSingle();
    updatedByEmail = (adminRow?.email as string | undefined) ?? null;
  }

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link
          href="/admin/wiki"
          className="text-mip-gray-500 hover:text-mip-gray-900"
        >
          ← Wiki
        </Link>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h1
            className="mip-heading text-3xl mip-double-underline inline-block pb-1"
            style={{ color: "var(--color-mip-purple)" }}
          >
            {page.title}
          </h1>
          {page.summary && (
            <p className="mt-3 text-base text-mip-gray-700">{page.summary}</p>
          )}
          <p className="mt-2 flex items-center gap-1 text-xs text-mip-gray-500">
            <Clock className="w-3 h-3" />
            Updated {new Date(page.updated_at).toLocaleString()}
            {updatedByEmail && <> by {updatedByEmail}</>}
            <span className="mx-2">·</span>
            <span className="font-mono">/{page.slug}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/admin/wiki/${page.slug}/edit`}
            className="inline-flex items-center gap-2 px-4 py-2 mip-button-text"
            style={{
              backgroundColor: "var(--color-mip-purple)",
              color: "var(--color-mip-white)",
              borderRadius: "var(--radius-button)",
            }}
          >
            <Pencil className="w-4 h-4" />
            Edit
          </Link>
          <DeleteWikiPageButton id={page.id} title={page.title} />
        </div>
      </div>

      <article
        className="border border-mip-gray-200 bg-white p-6"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        <WikiMarkdown source={page.body_md} />
      </article>
    </div>
  );
}


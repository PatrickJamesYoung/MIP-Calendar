import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updatePage } from "../../actions";
import { WikiPageForm } from "../../wiki-page-form";

export const dynamic = "force-dynamic";

interface WikiPageRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
}

export default async function EditWikiPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireAdmin();

  const supabase = await createClient();
  const { data } = await supabase
    .from("wiki_pages")
    .select("id,slug,title,summary,body_md")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) return notFound();
  const page = data as WikiPageRow;

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
          Edit page
        </h1>
        <p className="mt-2 text-sm text-mip-gray-700">
          Saving creates a new version. Previous versions stay accessible in
          history.
        </p>
      </div>

      <WikiPageForm
        mode="edit"
        action={updatePage}
        initial={{
          id: page.id,
          slug: page.slug,
          title: page.title,
          summary: page.summary,
          body_md: page.body_md,
        }}
        cancelHref={`/admin/wiki/${page.slug}`}
      />
    </div>
  );
}

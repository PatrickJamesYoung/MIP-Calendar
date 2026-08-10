import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createPage } from "../actions";
import { WikiPageForm } from "../wiki-page-form";

export const dynamic = "force-dynamic";

export default async function NewWikiPage() {
  await requireAdmin();

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

      <div>
        <h1
          className="mip-heading text-2xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          New page
        </h1>
        <p className="mt-2 text-sm text-mip-gray-700">
          Create an internal admin knowledge base page. Every save is versioned.
        </p>
      </div>

      <WikiPageForm mode="create" action={createPage} cancelHref="/admin/wiki" />
    </div>
  );
}

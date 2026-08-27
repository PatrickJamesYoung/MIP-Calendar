import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveSpaceTemplate } from "./actions";

export const dynamic = "force-dynamic";

interface Template {
  key: string;
  label: string;
  description: string | null;
  placeholders: string[];
  subject: string | null;
  body: string | null;
  updated_at: string;
}

export default async function SpacesTemplatesPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("spaces_email_templates")
    .select("key,label,description,placeholders,subject,body,updated_at")
    .order("key");
  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        Failed to load templates: {error.message}
      </div>
    );
  }
  const templates = (data ?? []) as Template[];

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link
          href="/admin/spaces"
          className="text-neutral-500 hover:text-neutral-900"
        >
          ← Spaces queue
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Email templates
          </h1>
          <p className="mt-2 text-sm text-neutral-700">
            Edit subject and body for each transactional email. Use{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5">
              {"{{placeholder}}"}
            </code>{" "}
            to insert reservation data. Placeholders are listed above each
            template.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/admin/spaces/catalog"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
          >
            Catalog
          </Link>
          <Link
            href="/admin/spaces/settings"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
          >
            Settings
          </Link>
        </div>
      </div>

      <div className="space-y-6">
        {templates.map((t) => (
          <TemplateCard key={t.key} template={t} />
        ))}
        {templates.length === 0 && (
          <p className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
            No templates seeded yet. Run the seed migration first.
          </p>
        )}
      </div>
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const placeholders = template.placeholders ?? [];

  return (
    <section
      id={`tpl-${template.key}`}
      className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            {template.label}
          </h2>
          <p className="text-xs text-neutral-500">
            <code>{template.key}</code>
            {template.updated_at && (
              <>
                {" · updated "}
                {new Date(template.updated_at).toLocaleDateString()}
              </>
            )}
          </p>
        </div>
      </div>

      {template.description && (
        <p className="mb-3 text-sm text-neutral-700">{template.description}</p>
      )}

      {placeholders.length > 0 && (
        <div className="mb-4 rounded-md bg-neutral-50 p-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Available placeholders
          </div>
          <div className="flex flex-wrap gap-1.5">
            {placeholders.map((p) => (
              <code
                key={p}
                className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] text-neutral-700"
                title={`Insert {{${p}}} into the subject or body`}
              >
                {`{{${p}}}`}
              </code>
            ))}
          </div>
        </div>
      )}

      <form action={saveSpaceTemplate} className="space-y-3">
        <input type="hidden" name="key" value={template.key} />

        <label className="block text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Subject
          </div>
          <input
            type="text"
            name="subject"
            defaultValue={template.subject ?? ""}
            className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </label>

        <label className="block text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Body (plain text)
          </div>
          <textarea
            name="body"
            defaultValue={template.body ?? ""}
            rows={12}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
          />
        </label>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
          >
            Save template
          </button>
        </div>
      </form>
    </section>
  );
}

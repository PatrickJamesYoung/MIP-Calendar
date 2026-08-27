import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveSpaceSettings } from "./actions";
import { KNOWN_SPACE_SETTINGS, type SpaceSettingSpec } from "./schema";
import { TiptapEditor } from "@/components/admin/wiki/tiptap-editor";

export const dynamic = "force-dynamic";

interface Row {
  key: string;
  value: unknown;
  notes: string | null;
  updated_at: string;
}

export default async function SpacesSettingsPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("spaces_settings")
    .select("key,value,notes,updated_at")
    .order("key");
  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        Failed to load settings: {error.message}
      </div>
    );
  }
  const rows = (data ?? []) as Row[];
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const knownKeys = new Set(KNOWN_SPACE_SETTINGS.map((s) => s.key));
  const otherRows = rows.filter((r) => !knownKeys.has(r.key));

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
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-neutral-700">
            Storefront and workflow configuration. Values are stored as jsonb.
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
            href="/admin/spaces/templates"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
          >
            Email templates
          </Link>
        </div>
      </div>

      <form action={saveSpaceSettings} className="space-y-6">
        <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-4 space-y-4">
            {KNOWN_SPACE_SETTINGS.map((spec) => (
              <SettingField
                key={spec.key}
                spec={spec}
                row={byKey.get(spec.key) ?? null}
              />
            ))}
          </div>
        </section>

        {otherRows.length > 0 && (
          <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Other
            </h2>
            <p className="mb-3 text-xs text-neutral-500">
              Keys present in the database with no schema definition. Edit as
              raw JSON.
            </p>
            <div className="space-y-4">
              {otherRows.map((r) => (
                <RawJsonField key={r.key} row={r} />
              ))}
            </div>
          </section>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
          >
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}

function SettingField({
  spec,
  row,
}: {
  spec: SpaceSettingSpec;
  row: Row | null;
}) {
  const stringValue = coerceForInput(row?.value, spec.type);
  const inputName = `key:${spec.key}`;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label
          htmlFor={inputName}
          className="text-sm font-medium text-neutral-900"
        >
          {spec.label}
        </label>
        <code className="text-[11px] text-neutral-500">{spec.key}</code>
      </div>
      {spec.help && (
        <p className="mb-2 text-xs text-neutral-500">{spec.help}</p>
      )}
      {spec.type === "html" ? (
        <TiptapEditor
          name={inputName}
          initialHtml={stringValue}
          placeholder="Write the storefront intro here…"
        />
      ) : spec.type === "number" ? (
        <input
          id={inputName}
          name={inputName}
          type="number"
          step="any"
          defaultValue={stringValue}
          className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
      ) : (
        <input
          id={inputName}
          name={inputName}
          type="text"
          defaultValue={stringValue}
          className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
      )}
    </div>
  );
}

function RawJsonField({ row }: { row: Row }) {
  const inputName = `key:${row.key}`;
  const stringValue = JSON.stringify(row.value ?? null, null, 2);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <label
          htmlFor={inputName}
          className="text-sm font-medium text-neutral-900"
        >
          {row.key}
        </label>
      </div>
      {row.notes && (
        <p className="mb-2 text-xs text-neutral-500">{row.notes}</p>
      )}
      <textarea
        id={inputName}
        name={inputName}
        defaultValue={stringValue}
        rows={4}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
      />
    </div>
  );
}

function coerceForInput(value: unknown, type: SpaceSettingSpec["type"]): string {
  if (value == null) return "";
  switch (type) {
    case "string":
    case "html":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "number":
      if (typeof value === "number") return String(value);
      if (typeof value === "string" && value.trim() !== "") return value;
      return "";
    default:
      return typeof value === "string" ? value : JSON.stringify(value);
  }
}

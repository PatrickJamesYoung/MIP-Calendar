import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveGearSettings } from "./actions";
import { KNOWN_SETTINGS, GROUPS, type SettingSpec } from "./schema";

export const dynamic = "force-dynamic";

interface Row {
  key: string;
  value: unknown;
  notes: string | null;
  updated_at: string;
}

export default async function GearSettingsPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("gear_settings")
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

  // Any settings in the DB we don't have a spec for get shown in an "Other" group
  const knownKeys = new Set(KNOWN_SETTINGS.map((s) => s.key));
  const otherRows = rows.filter((r) => !knownKeys.has(r.key));

  const isSuper = admin.role === "super";
  const visibleSettings = KNOWN_SETTINGS.filter((s) => isSuper || !s.superOnly);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link
          href="/admin/gear"
          className="text-mip-gray-500 hover:text-mip-gray-900"
        >
          ← Gear queue
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="mip-heading text-2xl mip-double-underline inline-block pb-1"
            style={{ color: "var(--color-mip-purple)" }}
          >
            Settings
          </h1>
          <p className="mt-2 text-sm text-mip-gray-700">
            Storefront and workflow configuration. Values are stored as jsonb.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/admin/gear/catalog"
            className="rounded-md border border-mip-gray-300 bg-white px-3 py-1.5 hover:bg-mip-gray-50"
          >
            Catalog
          </Link>
          <Link
            href="/admin/gear/templates"
            className="rounded-md border border-mip-gray-300 bg-white px-3 py-1.5 hover:bg-mip-gray-50"
          >
            Email templates
          </Link>
        </div>
      </div>

      <form action={saveGearSettings} className="space-y-8">
        {GROUPS.map((g) => {
          const groupSettings = visibleSettings.filter((s) => s.group === g.id);
          if (groupSettings.length === 0) return null;
          return (
            <GroupSection
              key={g.id}
              label={g.label}
              description={g.description}
              settings={groupSettings}
              rows={byKey}
            />
          );
        })}

        {isSuper && otherRows.length > 0 && (
          <section className="rounded-lg border border-mip-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-mip-gray-500 mb-1">
              Other keys
            </h2>
            <p className="mb-4 text-xs text-mip-gray-500">
              Settings in the database without a known schema. Edit as raw
              JSON.
            </p>
            <div className="space-y-4">
              {otherRows.map((r) => (
                <RawJsonField
                  key={r.key}
                  settingKey={r.key}
                  currentValue={r.value}
                  notes={r.notes}
                />
              ))}
            </div>
          </section>
        )}

        <div className="sticky bottom-4 z-10 flex justify-end">
          <button
            type="submit"
            className="rounded-md px-6 py-2.5 text-sm font-semibold text-white shadow-lg"
            style={{ backgroundColor: "var(--color-mip-purple)" }}
          >
            Save all settings
          </button>
        </div>
      </form>
    </div>
  );
}

function GroupSection({
  label,
  description,
  settings,
  rows,
}: {
  label: string;
  description?: string;
  settings: SettingSpec[];
  rows: Map<string, Row>;
}) {
  return (
    <section className="rounded-lg border border-mip-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-mip-gray-500">
        {label}
      </h2>
      {description && (
        <p className="mt-1 mb-4 text-xs text-mip-gray-500">{description}</p>
      )}
      <div className="space-y-4">
        {settings.map((s) => (
          <SettingField
            key={s.key}
            spec={s}
            currentValue={rows.get(s.key)?.value}
          />
        ))}
      </div>
    </section>
  );
}

function SettingField({
  spec,
  currentValue,
}: {
  spec: SettingSpec;
  currentValue: unknown;
}) {
  const name = `key:${spec.key}`;
  const displayValue = toStringForType(currentValue, spec.type);

  return (
    <label className="block text-sm">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-mip-gray-900 font-medium">{spec.label}</span>
        <code className="text-[10px] text-mip-gray-400">{spec.key}</code>
      </div>
      {spec.type === "email-list" || spec.type === "json" || spec.type === "raw" ? (
        <textarea
          name={name}
          defaultValue={displayValue}
          rows={spec.type === "email-list" ? 2 : 4}
          placeholder={spec.placeholder}
          className="w-full rounded-md border border-mip-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
        />
      ) : (
        <input
          type={spec.type === "number" ? "number" : "text"}
          step={spec.type === "number" ? "any" : undefined}
          name={name}
          defaultValue={displayValue}
          placeholder={spec.placeholder}
          className="w-full rounded-md border border-mip-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
        />
      )}
      {spec.help && (
        <p className="mt-1 text-xs text-mip-gray-500">{spec.help}</p>
      )}
    </label>
  );
}

function RawJsonField({
  settingKey,
  currentValue,
  notes,
}: {
  settingKey: string;
  currentValue: unknown;
  notes: string | null;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-mip-gray-900 font-medium">{settingKey}</span>
        <code className="text-[10px] text-mip-gray-400">jsonb</code>
      </div>
      <textarea
        name={`key:${settingKey}`}
        defaultValue={JSON.stringify(currentValue, null, 2)}
        rows={4}
        className="w-full rounded-md border border-mip-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
      />
      {notes && <p className="mt-1 text-xs text-mip-gray-500">{notes}</p>}
    </label>
  );
}

function toStringForType(value: unknown, type: SettingSpec["type"]): string {
  if (value === null || value === undefined) return "";
  switch (type) {
    case "string":
      return typeof value === "string" ? value : String(value);
    case "number":
      return typeof value === "number" ? String(value) : String(value);
    case "email-list":
      if (Array.isArray(value)) return value.join("\n");
      if (typeof value === "string") return value;
      return JSON.stringify(value);
    case "json":
    case "raw":
      return JSON.stringify(value, null, 2);
    default:
      return String(value);
  }
}

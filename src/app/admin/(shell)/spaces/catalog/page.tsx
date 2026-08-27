import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createSpace,
  updateSpace,
  toggleSpaceActive,
  deleteSpace,
} from "./actions";
import { PhotoField } from "./photo-field";

export const dynamic = "force-dynamic";

interface Space {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  capacity: number | null;
  suggested_contribution_per_hour: number;
  short_description: string | null;
  how_to_use_url: string | null;
  photo_url: string | null;
  active: boolean;
  sort_order: number;
  updated_at: string;
}

export default async function SpacesCatalogPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("spaces")
    .select(
      "id,slug,name,category,capacity,suggested_contribution_per_hour,short_description,how_to_use_url,photo_url,active,sort_order,updated_at"
    )
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        Failed to load catalog: {error.message}
      </div>
    );
  }
  const items = (data ?? []) as Space[];

  const categorySet = new Set<string>();
  for (const it of items) if (it.category) categorySet.add(it.category);
  const categories = Array.from(categorySet).sort();

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
          <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
          <p className="mt-2 text-sm text-neutral-700">
            {items.length} space{items.length === 1 ? "" : "s"} ·{" "}
            {items.filter((i) => i.active).length} active
          </p>
        </div>

        <div className="flex gap-2 text-sm">
          <Link
            href="/admin/spaces/templates"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
          >
            Email templates
          </Link>
          <Link
            href="/admin/spaces/settings"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-50"
          >
            Settings
          </Link>
        </div>
      </div>

      <datalist id="space-category-suggestions">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <NewSpaceForm />

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Sort</th>
              <th className="px-3 py-2 font-medium">Name / slug</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Capacity</th>
              <th className="px-3 py-2 text-right font-medium">$/hr</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <SpaceRow key={it.id} item={it} />
            ))}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-neutral-500"
                >
                  No spaces yet. Use the form above to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function NewSpaceForm() {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Add space
      </h2>
      <form action={createSpace} className="grid gap-3 sm:grid-cols-6">
        <Input label="Name *" name="name" required className="sm:col-span-3" />
        <Input
          label="Slug (auto if blank)"
          name="slug"
          className="sm:col-span-2"
        />
        <Input
          label="Sort"
          name="sort_order"
          type="number"
          defaultValue="0"
          className="sm:col-span-1"
        />

        <Input
          label="Category"
          name="category"
          list="space-category-suggestions"
          className="sm:col-span-2"
        />
        <Input
          label="Capacity"
          name="capacity"
          type="number"
          className="sm:col-span-1"
        />
        <Input
          label="Contribution ($/hr)"
          name="suggested_contribution_per_hour"
          type="number"
          step="0.01"
          defaultValue="0"
          className="sm:col-span-3"
        />

        <Input
          label="Short description"
          name="short_description"
          className="sm:col-span-3"
        />
        <Input
          label="How-to-use URL"
          name="how_to_use_url"
          type="url"
          className="sm:col-span-3"
        />
        <PhotoField className="sm:col-span-6" />

        <label className="flex items-center gap-2 text-sm sm:col-span-6">
          <input
            type="checkbox"
            name="active"
            defaultChecked
            className="h-4 w-4"
          />
          <span>Active in storefront</span>
        </label>

        <div className="sm:col-span-6 flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800"
          >
            Add space
          </button>
        </div>
      </form>
    </section>
  );
}

function SpaceRow({ item }: { item: Space }) {
  return (
    <>
      <tr className="border-t border-neutral-200 hover:bg-neutral-50">
        <td className="px-3 py-2 tabular-nums text-neutral-500">
          {item.sort_order}
        </td>
        <td className="px-3 py-2">
          <div className="font-medium">{item.name}</div>
          <div className="text-xs text-neutral-500">{item.slug}</div>
        </td>
        <td className="px-3 py-2 text-neutral-700">{item.category ?? "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {item.capacity ?? "—"}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          ${Number(item.suggested_contribution_per_hour).toFixed(2)}
        </td>
        <td className="px-3 py-2">
          <form action={toggleSpaceActive}>
            <input type="hidden" name="id" value={item.id} />
            <input
              type="hidden"
              name="next_active"
              value={item.active ? "false" : "true"}
            />
            <button
              type="submit"
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                item.active
                  ? "bg-emerald-100 text-emerald-900"
                  : "bg-neutral-100 text-neutral-500"
              }`}
              title={item.active ? "Click to deactivate" : "Click to activate"}
            >
              {item.active ? "Active" : "Inactive"}
            </button>
          </form>
        </td>
        <td className="px-3 py-2 text-right"></td>
      </tr>
      <tr className="border-b border-neutral-200">
        <td colSpan={7} className="px-0 py-0">
          <details className="group">
            <summary className="cursor-pointer px-4 py-2 text-xs text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900">
              Edit details
            </summary>
            <div className="bg-neutral-50 px-4 py-4">
              <EditForm item={item} />
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

function EditForm({ item }: { item: Space }) {
  return (
    <form action={updateSpace} className="grid gap-3 sm:grid-cols-6">
      <input type="hidden" name="id" value={item.id} />

      <Input
        label="Name"
        name="name"
        defaultValue={item.name}
        className="sm:col-span-3"
      />
      <Input
        label="Slug"
        name="slug"
        defaultValue={item.slug}
        className="sm:col-span-2"
      />
      <Input
        label="Sort"
        name="sort_order"
        type="number"
        defaultValue={String(item.sort_order)}
        className="sm:col-span-1"
      />

      <Input
        label="Category"
        name="category"
        defaultValue={item.category ?? ""}
        list="space-category-suggestions"
        className="sm:col-span-2"
      />
      <Input
        label="Capacity"
        name="capacity"
        type="number"
        defaultValue={item.capacity != null ? String(item.capacity) : ""}
        className="sm:col-span-1"
      />
      <Input
        label="Contribution ($/hr)"
        name="suggested_contribution_per_hour"
        type="number"
        step="0.01"
        defaultValue={String(item.suggested_contribution_per_hour)}
        className="sm:col-span-3"
      />

      <Input
        label="Short description"
        name="short_description"
        defaultValue={item.short_description ?? ""}
        className="sm:col-span-3"
      />
      <Input
        label="How-to-use URL"
        name="how_to_use_url"
        type="url"
        defaultValue={item.how_to_use_url ?? ""}
        className="sm:col-span-3"
      />
      <PhotoField defaultValue={item.photo_url} className="sm:col-span-6" />

      <label className="flex items-center gap-2 text-sm sm:col-span-6">
        <input
          type="checkbox"
          name="active"
          defaultChecked={item.active}
          className="h-4 w-4"
        />
        <span>Active in storefront</span>
      </label>

      <div className="sm:col-span-6 flex justify-between gap-2">
        <ConfirmDelete id={item.id} name={item.name} />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Save changes
        </button>
      </div>
    </form>
  );
}

function ConfirmDelete({ id, name }: { id: string; name: string }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer rounded-md border border-rose-300 bg-white px-3 py-2 text-sm text-rose-700 hover:bg-rose-50">
        Delete
      </summary>
      <form
        action={deleteSpace}
        className="absolute left-0 z-10 mt-2 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg"
      >
        <input type="hidden" name="id" value={id} />
        <p className="mb-2 text-sm">
          Delete <span className="font-medium">{name}</span>? This is permanent
          and will fail if any reservations still reference it.
        </p>
        <button
          type="submit"
          className="w-full rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
        >
          Yes, delete
        </button>
      </form>
    </details>
  );
}

function Input({
  label,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <input
        {...rest}
        className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
      />
    </label>
  );
}

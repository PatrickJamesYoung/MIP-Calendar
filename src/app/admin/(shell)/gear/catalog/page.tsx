import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createGearItem,
  updateGearItem,
  toggleGearItemActive,
  deleteGearItem,
} from "./actions";
import { PhotoField } from "./photo-field";

export const dynamic = "force-dynamic";

interface Item {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  quantity_total: number;
  suggested_contribution: number;
  unit: "per_event" | "per_day";
  short_description: string | null;
  how_to_use_url: string | null;
  photo_url: string | null;
  follow_up_question: string | null;
  requires_electricity: boolean;
  active: boolean;
  sort_order: number;
  updated_at: string;
}

export default async function GearCatalogPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("gear_items")
    .select(
      "id,slug,name,category,quantity_total,suggested_contribution,unit,short_description,how_to_use_url,photo_url,follow_up_question,requires_electricity,active,sort_order,updated_at"
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
  const items = (data ?? []) as Item[];

  // Collect categories for the datalist
  const categorySet = new Set<string>();
  for (const it of items) if (it.category) categorySet.add(it.category);
  const categories = Array.from(categorySet).sort();

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
            Catalog
          </h1>
          <p className="mt-2 text-sm text-mip-gray-700">
            {items.length} item{items.length === 1 ? "" : "s"} ·{" "}
            {items.filter((i) => i.active).length} active
          </p>
        </div>

        <div className="flex gap-2 text-sm">
          <Link
            href="/admin/gear/templates"
            className="rounded-md border border-mip-gray-300 bg-white px-3 py-1.5 hover:bg-mip-gray-50"
          >
            Email templates
          </Link>
          <Link
            href="/admin/gear/settings"
            className="rounded-md border border-mip-gray-300 bg-white px-3 py-1.5 hover:bg-mip-gray-50"
          >
            Settings
          </Link>
        </div>
      </div>

      <datalist id="gear-category-suggestions">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <NewItemForm />

      <section className="rounded-lg border border-mip-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-mip-gray-50 text-left text-xs uppercase tracking-wide text-mip-gray-500">
            <tr>
              <th className="px-3 py-2 font-medium">Sort</th>
              <th className="px-3 py-2 font-medium">Name / slug</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">$</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <ItemRow key={it.id} item={it} />
            ))}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-mip-gray-500"
                >
                  No items yet. Use the form above to add one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function NewItemForm() {
  return (
    <section className="rounded-lg border border-mip-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-mip-gray-500 mb-3">
        Add item
      </h2>
      <form action={createGearItem} className="grid gap-3 sm:grid-cols-6">
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
          list="gear-category-suggestions"
          className="sm:col-span-2"
        />
        <Input
          label="Qty total"
          name="quantity_total"
          type="number"
          defaultValue="1"
          className="sm:col-span-1"
        />
        <Input
          label="Contribution ($)"
          name="suggested_contribution"
          type="number"
          step="0.01"
          defaultValue="0"
          className="sm:col-span-1"
        />
        <Select
          label="Unit"
          name="unit"
          defaultValue="per_event"
          options={[
            { value: "per_event", label: "per event" },
            { value: "per_day", label: "per day" },
          ]}
          className="sm:col-span-2"
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

        <Input
          label="Follow-up question (optional)"
          name="follow_up_question"
          placeholder="e.g. How many people are you expecting?"
          className="sm:col-span-6"
        />
        <p className="sm:col-span-6 -mt-2 text-xs text-mip-gray-500">
          If set, users must answer this before adding the item to their
          list. Leave empty to skip.
        </p>

        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input
            type="checkbox"
            name="requires_electricity"
            className="h-4 w-4"
          />
          <span>Requires electricity</span>
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
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
            className="rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm"
            style={{ backgroundColor: "var(--color-mip-purple)" }}
          >
            Add item
          </button>
        </div>
      </form>
    </section>
  );
}

function ItemRow({ item }: { item: Item }) {
  return (
    <>
      <tr className="border-t border-mip-gray-200 hover:bg-mip-gray-50">
        <td className="px-3 py-2 tabular-nums text-mip-gray-500">
          {item.sort_order}
        </td>
        <td className="px-3 py-2">
          <div className="font-medium">{item.name}</div>
          <div className="text-xs text-mip-gray-500">{item.slug}</div>
        </td>
        <td className="px-3 py-2 text-mip-gray-700">{item.category ?? "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {item.quantity_total}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          ${Number(item.suggested_contribution).toFixed(2)}
        </td>
        <td className="px-3 py-2 text-mip-gray-700">
          {item.unit === "per_day" ? "per day" : "per event"}
        </td>
        <td className="px-3 py-2">
          <form action={toggleGearItemActive}>
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
                  : "bg-mip-gray-100 text-mip-gray-500"
              }`}
              title={item.active ? "Click to deactivate" : "Click to activate"}
            >
              {item.active ? "Active" : "Inactive"}
            </button>
          </form>
        </td>
        <td className="px-3 py-2 text-right"></td>
      </tr>
      <tr className="border-b border-mip-gray-200">
        <td colSpan={8} className="px-0 py-0">
          <details className="group">
            <summary className="cursor-pointer px-4 py-2 text-xs text-mip-gray-500 hover:text-mip-purple hover:bg-mip-gray-50">
              Edit details
            </summary>
            <div className="bg-mip-gray-50 px-4 py-4">
              <EditForm item={item} />
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

function EditForm({ item }: { item: Item }) {
  return (
    <form action={updateGearItem} className="grid gap-3 sm:grid-cols-6">
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
        list="gear-category-suggestions"
        className="sm:col-span-2"
      />
      <Input
        label="Qty total"
        name="quantity_total"
        type="number"
        defaultValue={String(item.quantity_total)}
        className="sm:col-span-1"
      />
      <Input
        label="Contribution ($)"
        name="suggested_contribution"
        type="number"
        step="0.01"
        defaultValue={String(item.suggested_contribution)}
        className="sm:col-span-1"
      />
      <Select
        label="Unit"
        name="unit"
        defaultValue={item.unit}
        options={[
          { value: "per_event", label: "per event" },
          { value: "per_day", label: "per day" },
        ]}
        className="sm:col-span-2"
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

      <Input
        label="Follow-up question (optional)"
        name="follow_up_question"
        defaultValue={item.follow_up_question ?? ""}
        placeholder="e.g. How many people are you expecting?"
        className="sm:col-span-6"
      />
      <p className="sm:col-span-6 -mt-2 text-xs text-mip-gray-500">
        If set, users must answer this before adding the item to their
        list. Leave empty to skip.
      </p>

      <label className="flex items-center gap-2 text-sm sm:col-span-3">
        <input
          type="checkbox"
          name="requires_electricity"
          defaultChecked={item.requires_electricity}
          className="h-4 w-4"
        />
        <span>Requires electricity</span>
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-3">
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
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: "var(--color-mip-purple)" }}
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
        action={deleteGearItem}
        className="absolute left-0 z-10 mt-2 w-72 rounded-lg border border-mip-gray-200 bg-white p-3 shadow-lg"
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
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-mip-gray-500">
        {label}
      </div>
      <input
        {...rest}
        className="w-full rounded-md border border-mip-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
      />
    </label>
  );
}

function Select({
  label,
  options,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-mip-gray-500">
        {label}
      </div>
      <select
        {...rest}
        className="w-full rounded-md border border-mip-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

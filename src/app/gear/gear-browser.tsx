"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Minus, Plus, ShoppingCart, Search, X } from "lucide-react";

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
  sort_order: number;
}

type Tier = "full" | "mid" | "low";

interface Props {
  items: Item[];
  tierLabels: Record<Tier, string>;
  tierMultipliers: Record<Tier, number>;
}

const ALL_CATEGORIES = "__all__";
const UNCATEGORIZED = "Other";

export function GearBrowser({ items, tierLabels, tierMultipliers }: Props) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [tier, setTier] = useState<Tier>("mid");
  const [openItem, setOpenItem] = useState<Item | null>(null);

  const multiplier = tierMultipliers[tier] ?? 1;

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) seen.add(it.category ?? UNCATEGORIZED);
    return Array.from(seen).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      const cat = it.category ?? UNCATEGORIZED;
      if (category !== ALL_CATEGORIES && cat !== category) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        (it.short_description ?? "").toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q)
      );
    });
  }, [items, query, category]);

  // Group filtered items by category, preserving alpha order per group.
  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of filtered) {
      const key = it.category ?? UNCATEGORIZED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const cartSubtotal = useMemo(() => {
    let sum = 0;
    for (const it of items) {
      const q = cart[it.slug] ?? 0;
      if (q > 0)
        sum += q * Number(it.suggested_contribution ?? 0) * multiplier;
    }
    return sum;
  }, [cart, items, multiplier]);

  const reserveUrl = useMemo(() => {
    const parts = Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([slug, q]) => `${slug}:${q}`);
    if (parts.length === 0) return null;
    return `/gear/reserve?items=${encodeURIComponent(
      parts.join(",")
    )}&tier=${tier}`;
  }, [cart, tier]);

  function setQty(slug: string, qty: number, max: number) {
    setCart((c) => {
      const copy = { ...c };
      const clamped = Math.max(0, Math.min(qty, max));
      if (clamped === 0) delete copy[slug];
      else copy[slug] = clamped;
      return copy;
    });
  }

  return (
    <div>
      {/* Filter + tier bar */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              aria-hidden
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-mip-gray-400"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items…"
              className="w-full rounded-md border border-mip-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-mip-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
          >
            <option value={ALL_CATEGORIES}>All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="ml-auto text-xs text-mip-gray-500 tabular-nums">
            {filtered.length} of {items.length} items
          </div>
        </div>

        <TierPicker tier={tier} onChange={setTier} labels={tierLabels} />
      </div>

      {/* Empty states */}
      {items.length === 0 && (
        <div className="rounded-lg border border-mip-gray-200 bg-white p-8 text-center text-mip-gray-500">
          No gear is currently available. Check back soon.
        </div>
      )}

      {items.length > 0 && filtered.length === 0 && (
        <div className="rounded-lg border border-mip-gray-200 bg-white p-8 text-center text-mip-gray-500">
          Nothing matches that filter.
        </div>
      )}

      {/* Grouped grid */}
      <div className="space-y-10">
        {grouped.map(([cat, catItems]) => (
          <section key={cat}>
            <h2
              className="mb-3 text-xs font-semibold uppercase tracking-wider text-mip-gray-500 border-b border-mip-gray-200 pb-1"
            >
              {cat}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {catItems.map((it) => {
                const qtyInCart = cart[it.slug] ?? 0;
                const adjustedPrice =
                  Number(it.suggested_contribution ?? 0) * multiplier;
                return (
                  <article
                    key={it.id}
                    onClick={() => setOpenItem(it)}
                    className={`cursor-pointer rounded-lg border bg-white shadow-sm overflow-hidden flex flex-col text-left transition hover:shadow-md focus-within:ring-2 focus-within:ring-mip-purple/40 ${
                      qtyInCart > 0
                        ? "border-mip-purple"
                        : "border-mip-gray-200"
                    }`}
                  >
                    {it.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.photo_url}
                        alt={it.name}
                        className="w-full aspect-[4/3] object-cover bg-mip-gray-100"
                      />
                    )}

                    <div className="p-4 flex-1 flex flex-col">
                      <h3 className="font-semibold text-mip-gray-900 leading-snug">
                        {it.name}
                      </h3>

                      {it.short_description && (
                        <p className="mt-1 text-xs text-mip-gray-600 leading-relaxed line-clamp-2">
                          {it.short_description}
                        </p>
                      )}

                      <div className="mt-auto pt-3 flex items-baseline justify-between">
                        <div className="text-sm">
                          <span className="font-medium tabular-nums text-mip-gray-900">
                            ${adjustedPrice.toFixed(2)}
                          </span>
                          <span className="text-xs text-mip-gray-500">
                            {" "}
                            / {it.unit === "per_day" ? "day" : "event"}
                          </span>
                        </div>
                        {qtyInCart > 0 ? (
                          <span
                            className="rounded-full bg-mip-purple/10 px-2 py-0.5 text-[11px] font-semibold text-mip-purple"
                          >
                            {qtyInCart} in list
                          </span>
                        ) : (
                          <span className="text-[11px] text-mip-gray-500">
                            Tap for details
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Sticky cart bar */}
      {cartCount > 0 && (
        <div className="sticky bottom-4 z-20 mt-8 flex justify-center">
          <div
            className="flex items-center gap-4 rounded-full px-5 py-3 shadow-lg"
            style={{
              backgroundColor: "var(--color-mip-purple)",
              color: "white",
            }}
          >
            <ShoppingCart className="h-5 w-5" aria-hidden />
            <div className="text-sm">
              <span className="font-semibold tabular-nums">{cartCount}</span>{" "}
              item{cartCount === 1 ? "" : "s"}
              <span className="opacity-60 mx-2">·</span>
              <span className="tabular-nums">
                ${cartSubtotal.toFixed(2)}
              </span>{" "}
              <span className="opacity-60">suggested</span>
            </div>
            {reserveUrl && (
              <Link
                href={reserveUrl}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold"
                style={{ color: "var(--color-mip-purple)" }}
              >
                Review request →
              </Link>
            )}
          </div>
        </div>
      )}

      {openItem && (
        <ItemModal
          item={openItem}
          multiplier={multiplier}
          initialQty={cart[openItem.slug] ?? 0}
          onClose={() => setOpenItem(null)}
          onSave={(qty) => {
            setQty(openItem.slug, qty, openItem.quantity_total);
            setOpenItem(null);
          }}
        />
      )}
    </div>
  );
}

// ────────────────── Tier picker ──────────────────

function TierPicker({
  tier,
  onChange,
  labels,
}: {
  tier: Tier;
  onChange: (t: Tier) => void;
  labels: Record<Tier, string>;
}) {
  return (
    <fieldset className="rounded-lg border border-mip-gray-200 bg-white p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-mip-gray-600">
        Sliding scale
      </legend>
      <p className="mb-3 text-xs text-mip-gray-500">
        Pick the tier that describes you. Prices below adjust — you can
        always pay less.
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        {(["full", "mid", "low"] as const).map((k) => (
          <label
            key={k}
            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
              tier === k
                ? "border-mip-purple bg-mip-purple/5"
                : "border-mip-gray-300 bg-white hover:bg-mip-gray-50"
            }`}
          >
            <input
              type="radio"
              name="tier"
              value={k}
              checked={tier === k}
              onChange={() => onChange(k)}
              className="mt-1"
            />
            <span className="leading-snug">{labels[k]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ────────────────── Item modal (quantity picker) ──────────────────

function ItemModal({
  item,
  multiplier,
  initialQty,
  onClose,
  onSave,
}: {
  item: Item;
  multiplier: number;
  initialQty: number;
  onClose: () => void;
  onSave: (qty: number) => void;
}) {
  const [qty, setQty] = useState<number>(initialQty > 0 ? initialQty : 1);
  const max = item.quantity_total;
  const adjustedUnit = Number(item.suggested_contribution ?? 0) * multiplier;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-mip-gray-200 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-mip-gray-900">
              {item.name}
            </h3>
            {item.category && (
              <p className="text-[11px] uppercase tracking-wide text-mip-gray-500">
                {item.category}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-mip-gray-400 hover:bg-mip-gray-100 hover:text-mip-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto">
          {item.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.photo_url}
              alt={item.name}
              className="w-full aspect-[4/3] object-cover bg-mip-gray-100"
            />
          )}

          <div className="p-5 space-y-4">
            {item.short_description && (
              <p className="text-sm text-mip-gray-700 leading-relaxed whitespace-pre-line">
                {item.short_description}
              </p>
            )}

            <div className="flex items-baseline justify-between text-sm">
              <div>
                <span className="font-semibold tabular-nums text-mip-gray-900">
                  ${adjustedUnit.toFixed(2)}
                </span>
                <span className="text-xs text-mip-gray-500">
                  {" "}
                  / {item.unit === "per_day" ? "day" : "event"}
                </span>
                {multiplier !== 1 && (
                  <span className="ml-2 text-xs text-mip-gray-400">
                    (adjusted for your tier)
                  </span>
                )}
              </div>
              <div className="text-xs text-mip-gray-500">
                {max} available
              </div>
            </div>

            {item.how_to_use_url && (
              <a
                href={item.how_to_use_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-mip-purple hover:underline"
              >
                How to use ↗
              </a>
            )}

            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-mip-gray-500">
                Quantity
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                  className="h-9 w-9 flex items-center justify-center rounded-md border border-mip-gray-300 hover:bg-mip-gray-50"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={max}
                  value={qty}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n))
                      setQty(Math.max(1, Math.min(max, n)));
                  }}
                  className="w-16 rounded-md border border-mip-gray-300 px-2 py-1.5 text-center text-sm tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(max, q + 1))}
                  aria-label="Increase quantity"
                  disabled={qty >= max}
                  className="h-9 w-9 flex items-center justify-center rounded-md border border-mip-gray-300 hover:bg-mip-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <span className="ml-2 text-sm text-mip-gray-600 tabular-nums">
                  Line total{" "}
                  <span className="font-medium text-mip-gray-900">
                    ${(qty * adjustedUnit).toFixed(2)}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-mip-gray-200 bg-mip-gray-50 px-5 py-3">
          {initialQty > 0 && (
            <button
              type="button"
              onClick={() => onSave(0)}
              className="rounded-md border border-mip-gray-300 bg-white px-4 py-2 text-sm font-medium text-mip-gray-700 hover:bg-mip-gray-50"
            >
              Remove from list
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-mip-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-mip-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(qty)}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--color-mip-purple)" }}
          >
            {initialQty > 0 ? "Update" : "Add to list"}
          </button>
        </footer>
      </div>
    </div>
  );
}

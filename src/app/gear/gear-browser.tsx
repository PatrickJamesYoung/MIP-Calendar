"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Minus, Plus, ShoppingCart, Search } from "lucide-react";

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

interface Props {
  items: Item[];
}

const ALL_CATEGORIES = "__all__";

export function GearBrowser({ items }: Props) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) if (it.category) seen.add(it.category);
    return Array.from(seen).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (category !== ALL_CATEGORIES && it.category !== category) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        (it.short_description ?? "").toLowerCase().includes(q) ||
        (it.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query, category]);

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartSubtotal = useMemo(() => {
    let sum = 0;
    for (const it of items) {
      const q = cart[it.slug] ?? 0;
      if (q > 0) sum += q * Number(it.suggested_contribution ?? 0);
    }
    return sum;
  }, [cart, items]);

  const reserveUrl = useMemo(() => {
    const parts = Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([slug, q]) => `${slug}:${q}`);
    if (parts.length === 0) return null;
    return `/gear/reserve?items=${encodeURIComponent(parts.join(","))}`;
  }, [cart]);

  function addOne(slug: string, max: number) {
    setCart((c) => {
      const next = (c[slug] ?? 0) + 1;
      if (next > max) return c;
      return { ...c, [slug]: next };
    });
  }
  function removeOne(slug: string) {
    setCart((c) => {
      const next = (c[slug] ?? 0) - 1;
      const copy = { ...c };
      if (next <= 0) delete copy[slug];
      else copy[slug] = next;
      return copy;
    });
  }

  return (
    <div className="mt-10">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
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

      {/* Empty state */}
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

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((it) => {
          const qtyInCart = cart[it.slug] ?? 0;
          return (
            <article
              key={it.id}
              className="rounded-lg border border-mip-gray-200 bg-white shadow-sm overflow-hidden flex flex-col"
            >
              {it.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.photo_url}
                  alt={it.name}
                  className="w-full aspect-[4/3] object-cover bg-mip-gray-100"
                />
              ) : (
                <div
                  className="w-full aspect-[4/3] flex items-center justify-center"
                  style={{ backgroundColor: "var(--color-mip-gray-100)" }}
                >
                  <span
                    className="mip-heading text-2xl"
                    style={{ color: "var(--color-mip-gray-400)" }}
                  >
                    {it.name.slice(0, 1)}
                  </span>
                </div>
              )}

              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-mip-gray-900 leading-snug">
                    {it.name}
                  </h3>
                  {it.category && (
                    <span className="text-[10px] uppercase tracking-wide text-mip-gray-500 shrink-0">
                      {it.category}
                    </span>
                  )}
                </div>

                {it.short_description && (
                  <p className="mt-1 text-xs text-mip-gray-600 leading-relaxed">
                    {it.short_description}
                  </p>
                )}

                <div className="mt-auto pt-3 flex items-baseline justify-between">
                  <div className="text-sm">
                    <span className="font-medium tabular-nums text-mip-gray-900">
                      ${Number(it.suggested_contribution).toFixed(2)}
                    </span>
                    <span className="text-xs text-mip-gray-500">
                      {" "}
                      / {it.unit === "per_day" ? "day" : "event"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {qtyInCart > 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => removeOne(it.slug)}
                          aria-label={`Remove one ${it.name}`}
                          className="h-8 w-8 flex items-center justify-center rounded-md border border-mip-gray-300 hover:bg-mip-gray-50"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="min-w-[1.5rem] text-center text-sm font-medium tabular-nums">
                          {qtyInCart}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            addOne(it.slug, it.quantity_total)
                          }
                          disabled={qtyInCart >= it.quantity_total}
                          aria-label={`Add another ${it.name}`}
                          className="h-8 w-8 flex items-center justify-center rounded-md border border-mip-gray-300 hover:bg-mip-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addOne(it.slug, it.quantity_total)}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                        style={{ backgroundColor: "var(--color-mip-purple)" }}
                      >
                        Add
                      </button>
                    )}
                  </div>
                </div>

                {it.how_to_use_url && (
                  <a
                    href={it.how_to_use_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 text-[11px] text-mip-gray-500 hover:text-mip-purple hover:underline"
                  >
                    How to use ↗
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Sticky cart bar */}
      {cartCount > 0 && (
        <div className="sticky bottom-4 z-20 mt-8 flex justify-center">
          <div
            className="flex items-center gap-4 rounded-full px-5 py-3 shadow-lg"
            style={{ backgroundColor: "var(--color-mip-purple)", color: "white" }}
          >
            <ShoppingCart className="h-5 w-5" aria-hidden />
            <div className="text-sm">
              <span className="font-semibold tabular-nums">{cartCount}</span>{" "}
              item{cartCount === 1 ? "" : "s"}
              <span className="opacity-60 mx-2">·</span>
              <span className="tabular-nums">${cartSubtotal.toFixed(2)}</span>{" "}
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
    </div>
  );
}

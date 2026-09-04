"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X, Users } from "lucide-react";

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
  sort_order: number;
}

type Tier = "full" | "mid" | "low";

interface Props {
  spaces: Space[];
  donationMinHours: number;
  tierLabels: Record<Tier, string>;
  tierMultipliers: Record<Tier, number>;
  /**
   * When true, the Continue link opens in the top-level window (breaks out
   * of the iframe) and points at an absolute reserve URL derived from
   * `reserveBaseUrl`. Used by /embed/spaces.
   */
  embed?: boolean;
  /**
   * Absolute origin of the reserve page when embedded — e.g.
   * https://app.movementinfrastructureproject.org . Ignored when !embed.
   */
  reserveBaseUrl?: string;
}

const ALL_CATEGORIES = "__all__";
const UNCATEGORIZED = "Other";

function hydrateSelectionFromParams(
  params: URLSearchParams | null,
  spaces: Space[]
): Set<string> {
  const raw = params?.get("spaces");
  if (!raw) return new Set<string>();
  const slugs = new Set<string>();
  const validSlugs = new Set(spaces.map((s) => s.slug));
  for (const part of raw.split(",")) {
    const slug = part.trim().toLowerCase();
    if (validSlugs.has(slug)) slugs.add(slug);
  }
  return slugs;
}

export function SpacesBrowser({
  spaces,
  donationMinHours,
  tierLabels,
  tierMultipliers,
  embed = false,
  reserveBaseUrl = "",
}: Props) {
  const searchParams = useSearchParams();

  const [selected, setSelected] = useState<Set<string>>(() =>
    hydrateSelectionFromParams(searchParams, spaces)
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [openSpace, setOpenSpace] = useState<Space | null>(null);
  const [tier, setTier] = useState<Tier>(() => {
    const t = searchParams?.get("tier");
    return t === "full" || t === "mid" || t === "low" ? t : "full";
  });

  const multiplier = tierMultipliers[tier] ?? 1;

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const sp of spaces) seen.add(sp.category ?? UNCATEGORIZED);
    return Array.from(seen).sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
  }, [spaces]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return spaces.filter((sp) => {
      const cat = sp.category ?? UNCATEGORIZED;
      if (category !== ALL_CATEGORIES && cat !== category) return false;
      if (!q) return true;
      return (
        sp.name.toLowerCase().includes(q) ||
        (sp.short_description ?? "").toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q)
      );
    });
  }, [spaces, query, category]);

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const selectedSpaces = useMemo(
    () => spaces.filter((sp) => selected.has(sp.slug)),
    [spaces, selected]
  );
  const rateSum = selectedSpaces.reduce(
    (sum, sp) => sum + Number(sp.suggested_contribution_per_hour ?? 0),
    0
  );
  const adjustedRateSum = rateSum * multiplier;

  const reserveQuery = selected.size
    ? `?spaces=${encodeURIComponent(
        Array.from(selected).sort().join(",")
      )}&tier=${tier}`
    : "";
  const reserveHref = selected.size
    ? embed
      ? `${reserveBaseUrl}/spaces/reserve${reserveQuery}`
      : `/spaces/reserve${reserveQuery}`
    : "";

  return (
    <>
      {/* Sliding-scale tier picker — moved here from the reserve form so
          people see adjusted rates while browsing. */}
      <div className="mb-6">
        <TierPicker
          tier={tier}
          onChange={setTier}
          labels={tierLabels}
          multipliers={tierMultipliers}
        />
      </div>

      {/* Search + filters */}
      <div className="mb-6 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-mip-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search spaces…"
            className="w-full pl-9 pr-3 py-2 rounded-md border border-mip-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/30"
            aria-label="Search spaces"
          />
        </div>
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategory(ALL_CATEGORIES)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                category === ALL_CATEGORIES
                  ? "bg-mip-purple text-white border-mip-purple"
                  : "bg-white border-mip-gray-200 text-mip-gray-700 hover:border-mip-gray-300"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  category === cat
                    ? "bg-mip-purple text-white border-mip-purple"
                    : "bg-white border-mip-gray-200 text-mip-gray-700 hover:border-mip-gray-300"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Space grid */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-mip-gray-200 bg-white p-8 text-center text-mip-gray-600">
          {spaces.length === 0
            ? "No spaces are available for booking right now."
            : "No spaces match your search."}
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((sp) => {
            const isSelected = selected.has(sp.slug);
            const baseRate = Number(sp.suggested_contribution_per_hour ?? 0);
            const rate = baseRate * multiplier;
            const showAdjusted = baseRate > 0 && multiplier !== 1;
            return (
              <li key={sp.id}>
                <div
                  className={`h-full flex flex-col rounded-lg border bg-white overflow-hidden transition-shadow ${
                    isSelected
                      ? "border-mip-purple ring-2 ring-mip-purple/20"
                      : "border-mip-gray-200 hover:shadow-sm"
                  }`}
                >
                  {sp.photo_url && (
                    <button
                      type="button"
                      onClick={() => setOpenSpace(sp)}
                      className="block aspect-video bg-mip-gray-100 overflow-hidden"
                      aria-label={`View details for ${sp.name}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sp.photo_url}
                        alt={sp.name}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  )}
                  <div className="flex-1 flex flex-col p-4">
                    <button
                      type="button"
                      onClick={() => setOpenSpace(sp)}
                      className="text-left"
                    >
                      <h3 className="font-medium text-mip-gray-900 hover:text-mip-purple transition-colors">
                        {sp.name}
                      </h3>
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mip-gray-600">
                      {sp.capacity != null && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" /> up to {sp.capacity}
                        </span>
                      )}
                      {sp.category && <span>{sp.category}</span>}
                    </div>
                    {sp.short_description && (
                      <p className="mt-2 text-sm text-mip-gray-700 line-clamp-3">
                        {sp.short_description}
                      </p>
                    )}
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-sm text-mip-gray-700">
                        {baseRate > 0 ? (
                          <>
                            <span className="font-medium">${rate.toFixed(0)}</span>
                            <span className="text-mip-gray-500"> / hour suggested</span>
                            {showAdjusted && (
                              <span className="ml-1 text-xs text-mip-gray-500">
                                (was ${baseRate.toFixed(0)})
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-mip-gray-500">No suggested donation</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggle(sp.slug)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          isSelected
                            ? "bg-mip-purple text-white hover:bg-mip-purple/90"
                            : "border border-mip-purple text-mip-purple hover:bg-mip-purple/5"
                        }`}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sticky selection bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-auto md:max-w-2xl z-40">
          <div className="bg-white border border-mip-gray-200 rounded-full shadow-lg px-4 py-3 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-mip-gray-900">
                {selected.size} space{selected.size === 1 ? "" : "s"} selected
              </div>
              {rateSum > 0 && (
                <div className="text-xs text-mip-gray-500">
                  ~${(adjustedRateSum * donationMinHours).toFixed(0)}+ suggested ({donationMinHours}-hour minimum)
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="p-2 text-mip-gray-500 hover:text-mip-gray-900"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
            {embed ? (
              <a
                href={reserveHref}
                target="_top"
                rel="noopener"
                className="px-4 py-2 rounded-full text-sm font-medium text-white bg-mip-purple hover:bg-mip-purple/90"
              >
                Continue →
              </a>
            ) : (
              <Link
                href={reserveHref}
                className="px-4 py-2 rounded-full text-sm font-medium text-white bg-mip-purple hover:bg-mip-purple/90"
              >
                Continue →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Detail modal */}

      {openSpace && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpenSpace(null)}
        >
          <div
            className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-xl font-medium text-mip-gray-900">
                  {openSpace.name}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpenSpace(null)}
                  className="p-1 text-mip-gray-500 hover:text-mip-gray-900"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mip-gray-600">
                {openSpace.capacity != null && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" /> up to {openSpace.capacity}
                  </span>
                )}
                {openSpace.category && <span>{openSpace.category}</span>}
              </div>
              {openSpace.photo_url && (
                <div className="mt-4 aspect-video bg-mip-gray-100 rounded-md overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={openSpace.photo_url}
                    alt={openSpace.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              {openSpace.short_description && (
                <p className="mt-4 text-sm text-mip-gray-700 whitespace-pre-line">
                  {openSpace.short_description}
                </p>
              )}
              {openSpace.how_to_use_url && (
                <div className="mt-4">
                  <a
                    href={openSpace.how_to_use_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-mip-purple hover:underline"
                  >
                    More info →
                  </a>
                </div>
              )}
              <div className="mt-6 flex items-center justify-between border-t border-mip-gray-200 pt-4">
                <div className="text-sm text-mip-gray-700">
                  {Number(openSpace.suggested_contribution_per_hour) > 0 ? (
                    <>
                      <span className="font-medium">
                        ${(Number(openSpace.suggested_contribution_per_hour) * multiplier).toFixed(0)}
                      </span>
                      <span className="text-mip-gray-500"> / hour suggested</span>
                      {multiplier !== 1 && (
                        <span className="ml-1 text-xs text-mip-gray-500">
                          (was ${Number(openSpace.suggested_contribution_per_hour).toFixed(0)})
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-mip-gray-500">No suggested donation</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    toggle(openSpace.slug);
                    setOpenSpace(null);
                  }}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    selected.has(openSpace.slug)
                      ? "bg-mip-purple text-white hover:bg-mip-purple/90"
                      : "border border-mip-purple text-mip-purple hover:bg-mip-purple/5"
                  }`}
                >
                  {selected.has(openSpace.slug) ? "Remove" : "Select"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ────────────────── Tier picker ──────────────────

function TierPicker({
  tier,
  onChange,
  labels,
  multipliers,
}: {
  tier: Tier;
  onChange: (t: Tier) => void;
  labels: Record<Tier, string>;
  multipliers: Record<Tier, number>;
}) {
  return (
    <fieldset className="rounded-lg border border-mip-gray-200 bg-white p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-mip-gray-600">
        Sliding scale
      </legend>
      <p className="mb-3 text-xs text-mip-gray-500">
        Pick the tier that describes you. Suggested donations below adjust —
        it&rsquo;s honor-system, you can always pay less (or nothing).
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        {(["full", "mid", "low"] as const).map((k) => {
          const pct = Math.round((multipliers[k] ?? 1) * 100);
          return (
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
              <span className="leading-snug">
                {labels[k]}
                <span className="ml-1 text-xs text-mip-gray-500">
                  ({pct}%)
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

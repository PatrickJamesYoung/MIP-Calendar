import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MipSiteHeader } from "@/components/mip-site-header";
import { SiteFooter } from "@/components/site-footer";
import { ReserveSpacesForm } from "./reserve-form";

export const dynamic = "force-dynamic";

interface Space {
  id: string;
  slug: string;
  name: string;
  suggested_contribution_per_hour: number;
  category: string | null;
  capacity: number | null;
  active: boolean;
}

interface Setting {
  key: string;
  value: unknown;
}

export const metadata = {
  title: "Review your space request — MIP",
};

/**
 * Parses the ?spaces=slug-a,slug-b,slug-c query param into an ordered
 * list of unique slugs. Slugs are validated against a strict [a-z0-9-]
 * regex before we hit the DB.
 */
function parseSpaceSlugs(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const slug = part.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

export default async function ReserveSpacesPage({
  searchParams,
}: {
  searchParams: Promise<{ spaces?: string }>;
}) {
  const params = await searchParams;
  const slugs = parseSpaceSlugs(params.spaces);

  const supabase = await createClient();

  const [spacesRes, settingsRes] = await Promise.all([
    slugs.length > 0
      ? supabase
          .from("spaces")
          .select(
            "id,slug,name,suggested_contribution_per_hour,category,capacity,active"
          )
          .in("slug", slugs)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("spaces_settings")
      .select("key,value")
      .in("key", [
        "donation_min_hours",
        "donation_disclaimer",
        "tier_full_label",
        "tier_mid_label",
        "tier_low_label",
        "tier_full_multiplier",
        "tier_mid_multiplier",
        "tier_low_multiplier",
        "art_production_slug",
        "art_production_equipment",
      ]),
  ]);

  const spaces = ((spacesRes.data as Space[] | null) ?? []).filter(
    (sp) => sp.active
  );
  const bySlug = new Map(spaces.map((sp) => [sp.slug, sp]));
  // Preserve caller-provided order.
  const orderedSpaces = slugs
    .map((slug) => bySlug.get(slug))
    .filter((sp): sp is Space => sp !== undefined);

  const settings = (settingsRes.data ?? []) as Setting[];
  const s = new Map(settings.map((x) => [x.key, x.value]));
  const donationMinHours = Number(s.get("donation_min_hours") ?? 2);
  const donationDisclaimer =
    (s.get("donation_disclaimer") as string | undefined) ?? "";

  const tierLabels = {
    full: (s.get("tier_full_label") as string | undefined) ?? "Well-resourced organization",
    mid: (s.get("tier_mid_label") as string | undefined) ?? "Small organization or coalition",
    low: (s.get("tier_low_label") as string | undefined) ?? "Volunteer group or individual",
  };
  const tierMultipliers = {
    full: Number(s.get("tier_full_multiplier") ?? 1),
    mid: Number(s.get("tier_mid_multiplier") ?? 0.85),
    low: Number(s.get("tier_low_multiplier") ?? 0.65),
  };
  const artProductionSlug =
    (s.get("art_production_slug") as string | undefined) ?? "";
  const artProductionEquipmentRaw = s.get("art_production_equipment");
  const artProductionEquipment: string[] = Array.isArray(
    artProductionEquipmentRaw
  )
    ? (artProductionEquipmentRaw as unknown[])
        .map((v) => (typeof v === "string" ? v : ""))
        .filter((v) => v.length > 0)
    : [];

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <MipSiteHeader />
      <main
        className="mx-auto w-full px-6 py-8 flex-1"
        style={{ maxWidth: "820px" }}
      >
        <div className="text-sm mb-4">
          <Link
            href={
              slugs.length > 0
                ? `/spaces?spaces=${encodeURIComponent(slugs.join(","))}`
                : "/spaces"
            }
            className="text-mip-gray-500 hover:text-mip-gray-900"
          >
            ← Back to spaces
          </Link>
        </div>

        <h1
          className="mip-heading text-2xl md:text-3xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          Review your request
        </h1>

        {orderedSpaces.length === 0 ? (
          <div className="mt-8 rounded-lg border border-mip-gray-200 bg-white p-8 text-center">
            <p className="text-mip-gray-700">
              You haven&rsquo;t selected any spaces yet — head back to browse
              what&rsquo;s available.
            </p>
            <Link
              href="/spaces"
              className="mt-4 inline-block rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--color-mip-purple)" }}
            >
              Browse spaces
            </Link>
          </div>
        ) : (
          <ReserveSpacesForm
            spaces={orderedSpaces.map((sp) => ({
              slug: sp.slug,
              name: sp.name,
              category: sp.category,
              capacity: sp.capacity,
              ratePerHour: Number(sp.suggested_contribution_per_hour ?? 0),
            }))}
            donationMinHours={donationMinHours}
            donationDisclaimer={donationDisclaimer}
            tierLabels={tierLabels}
            tierMultipliers={tierMultipliers}
            artProductionSlug={artProductionSlug}
            artProductionEquipment={artProductionEquipment}
            turnstileSiteKey={turnstileSiteKey}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

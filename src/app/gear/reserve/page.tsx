import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ReserveForm } from "./reserve-form";
import { parseCart } from "./cart";

export const dynamic = "force-dynamic";

interface Item {
  id: string;
  slug: string;
  name: string;
  quantity_total: number;
  suggested_contribution: number;
  unit: "per_event" | "per_day";
  category: string | null;
  active: boolean;
}

interface Setting {
  key: string;
  value: unknown;
}

export const metadata = {
  title: "Review your gear request — MIP Gear Library",
};

export default async function ReservePage({
  searchParams,
}: {
  searchParams: Promise<{ items?: string }>;
}) {
  const params = await searchParams;
  const cart = parseCart(params.items);

  const supabase = await createClient();

  const slugs = cart.map((c) => c.slug);
  const [itemsRes, settingsRes] = await Promise.all([
    slugs.length > 0
      ? supabase
          .from("gear_items")
          .select(
            "id,slug,name,quantity_total,suggested_contribution,unit,category,active"
          )
          .in("slug", slugs)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("gear_settings")
      .select("key,value")
      .in("key", [
        "organization_name",
        "tentative_disclaimer",
        "min_notice_hours",
        "default_pickup_location",
        "default_organizer_contact_name",
        "default_organizer_contact_phone",
        "tier_full_label",
        "tier_mid_label",
        "tier_low_label",
      ]),
  ]);

  const items = ((itemsRes.data as Item[] | null) ?? []).filter((i) => i.active);
  const itemsBySlug = new Map(items.map((i) => [i.slug, i]));

  // Reconcile cart with catalog: drop unknown slugs, clamp qty to inventory
  const reconciled = cart
    .map(({ slug, quantity }) => {
      const it = itemsBySlug.get(slug);
      if (!it) return null;
      const q = Math.max(1, Math.min(quantity, it.quantity_total));
      return {
        item: it,
        quantity: q,
        line_full: q * Number(it.suggested_contribution ?? 0),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const subtotal = reconciled.reduce((sum, l) => sum + l.line_full, 0);

  const settings = (settingsRes.data ?? []) as Setting[];
  const s = new Map(settings.map((x) => [x.key, x.value]));
  const orgName = (s.get("organization_name") as string) ?? "MIP";
  const tentativeDisclaimer = s.get("tentative_disclaimer") as string | undefined;
  const minNoticeHours = (s.get("min_notice_hours") as number | undefined) ?? 48;
  const defaultPickupLocation = (s.get("default_pickup_location") as string) ?? "";
  const defaultContactName = (s.get("default_organizer_contact_name") as string) ?? "";
  const defaultContactPhone = (s.get("default_organizer_contact_phone") as string) ?? "";
  const tierLabels = {
    full: (s.get("tier_full_label") as string) ?? "Well-resourced organization",
    mid: (s.get("tier_mid_label") as string) ?? "Small organization or coalition",
    low: (s.get("tier_low_label") as string) ?? "Volunteer group or individual",
  };

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <main
        className="flex-1 mx-auto w-full px-6 py-10"
        style={{ maxWidth: "820px" }}
      >
        <div className="text-sm mb-4">
          <Link
            href="/gear"
            className="text-mip-gray-500 hover:text-mip-gray-900"
          >
            ← Back to gear library
          </Link>
        </div>

        <h1
          className="mip-heading text-3xl md:text-4xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          Review your request
        </h1>

        {reconciled.length === 0 ? (
          <div className="mt-8 rounded-lg border border-mip-gray-200 bg-white p-8 text-center">
            <p className="text-mip-gray-700">
              Your list is empty — head back to the gear library to add items.
            </p>
            <Link
              href="/gear"
              className="mt-4 inline-block rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "var(--color-mip-purple)" }}
            >
              Browse gear
            </Link>
          </div>
        ) : (
          <ReserveForm
            orgName={orgName}
            lines={reconciled.map((l) => ({
              slug: l.item.slug,
              name: l.item.name,
              unit: l.item.unit,
              quantity: l.quantity,
              unitContribution: Number(l.item.suggested_contribution ?? 0),
              lineFull: l.line_full,
              category: l.item.category,
            }))}
            subtotal={subtotal}
            minNoticeHours={minNoticeHours}
            tentativeDisclaimer={tentativeDisclaimer}
            defaultPickupLocation={defaultPickupLocation}
            defaultContactName={defaultContactName}
            defaultContactPhone={defaultContactPhone}
            tierLabels={tierLabels}
            turnstileSiteKey={turnstileSiteKey}
          />
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

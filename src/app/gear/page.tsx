import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { MipSiteHeader } from "@/components/mip-site-header";
import { SiteFooter } from "@/components/site-footer";
import { GearBrowser } from "./gear-browser";

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
  sort_order: number;
}

interface Setting {
  key: string;
  value: unknown;
}

export const metadata = {
  title: "Gear Library — Movement Infrastructure Project",
  description:
    "Free equipment loans for grassroots events in DC: mics, speakers, radios, mult boxes, and more.",
};

export default async function GearIndexPage() {
  const supabase = await createClient();

  const [itemsRes, settingsRes] = await Promise.all([
    supabase
      .from("gear_items")
      .select(
        "id,slug,name,category,quantity_total,suggested_contribution,unit,short_description,how_to_use_url,photo_url,follow_up_question,sort_order"
      )
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("gear_settings")
      .select("key,value")
      .in("key", [
        "tier_full_label",
        "tier_mid_label",
        "tier_low_label",
        "tier_full_multiplier",
        "tier_mid_multiplier",
        "tier_low_multiplier",
      ]),
  ]);

  const items = (itemsRes.data ?? []) as Item[];
  const settings = (settingsRes.data ?? []) as Setting[];
  const s = new Map(settings.map((row) => [row.key, row.value]));

  const tierLabels = {
    full: (s.get("tier_full_label") as string) ?? "Well-resourced organization",
    mid: (s.get("tier_mid_label") as string) ?? "Small organization or coalition",
    low: (s.get("tier_low_label") as string) ?? "Volunteer group or individual",
  };
  const tierMultipliers = {
    full: Number(s.get("tier_full_multiplier") ?? 1),
    mid: Number(s.get("tier_mid_multiplier") ?? 0.85),
    low: Number(s.get("tier_low_multiplier") ?? 0.65),
  };

  return (
    <div className="min-h-screen flex flex-col">
      <MipSiteHeader />
      <main
        className="mx-auto w-full px-6 py-8 flex-1"
        style={{ maxWidth: "1200px" }}
      >
        <section className="mb-8 max-w-3xl space-y-4 text-mip-gray-700">
          <p>
            Need gear for your action or event? We&rsquo;ve got you covered.
            We have sound equipment, staging, projectors, podiums, megaphones,
            tables, chairs, tents, marshal vests, and just about anything else
            you could need to support an action.
          </p>
          <p>
            Our gear library is a DIY operation. You pick up the gear you
            need, operate it at your action or event, and return it yourself.
            If you&rsquo;re looking to book a team to provide on-the-ground
            support with sound, production, live-streaming or other
            logistics, contact our partners at{" "}
            <a
              href="https://www.reaxn.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-mip-purple underline decoration-mip-purple/40 underline-offset-2 hover:decoration-mip-purple"
            >
              Re:Action
            </a>{" "}
            for a quote!
          </p>
        </section>
        <Suspense fallback={null}>
          <GearBrowser
            items={items}
            tierLabels={tierLabels}
            tierMultipliers={tierMultipliers}
          />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

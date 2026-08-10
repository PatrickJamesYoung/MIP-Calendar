import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
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
        "id,slug,name,category,quantity_total,suggested_contribution,unit,short_description,how_to_use_url,photo_url,sort_order"
      )
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("gear_settings")
      .select("key,value")
      .in("key", [
        "organization_name",
        "tentative_disclaimer",
        "min_notice_hours",
      ]),
  ]);

  const items = (itemsRes.data ?? []) as Item[];
  const settings = (settingsRes.data ?? []) as Setting[];

  const settingsMap = new Map(settings.map((s) => [s.key, s.value]));
  const orgName = (settingsMap.get("organization_name") as string) ?? "MIP";
  const disclaimer = settingsMap.get("tentative_disclaimer") as string | undefined;
  const minNoticeHours =
    (settingsMap.get("min_notice_hours") as number | undefined) ?? 48;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <main
        className="flex-1 mx-auto w-full px-6 py-10"
        style={{ maxWidth: "1120px" }}
      >
        <div className="max-w-2xl">
          <h1
            className="mip-heading text-3xl md:text-4xl mip-double-underline inline-block pb-1"
            style={{ color: "var(--color-mip-purple)" }}
          >
            Gear Library
          </h1>
          <p className="mt-4 text-sm md:text-base text-mip-gray-700 leading-relaxed">
            {orgName} lends event and organizing equipment to grassroots
            groups in DC. Add what you need to your list, then submit a
            reservation request — a human will review and confirm within{" "}
            <strong>3 business days</strong>.
          </p>
          <ul className="mt-4 text-sm text-mip-gray-700 leading-relaxed list-disc pl-5 space-y-1">
            <li>
              Suggested contributions are just that — pay what you can, or
              nothing.
            </li>
            <li>
              Requests need at least <strong>{minNoticeHours} hours</strong> of
              notice before pickup.
            </li>
            {disclaimer && <li>{disclaimer}</li>}
          </ul>
        </div>

        <GearBrowser items={items} />
      </main>

      <SiteFooter />
    </div>
  );
}

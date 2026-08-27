import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { MipSiteHeader } from "@/components/mip-site-header";
import { SiteFooter } from "@/components/site-footer";
import { SpacesBrowser } from "./spaces-browser";

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
  sort_order: number;
}

interface Setting {
  key: string;
  value: unknown;
}

export const metadata = {
  title: "Space Reservations — Movement Infrastructure Project",
  description:
    "Request space at our building for meetings, trainings, events, and organizing work.",
};

export default async function SpacesIndexPage() {
  const supabase = await createClient();

  const [spacesRes, settingsRes] = await Promise.all([
    supabase
      .from("spaces")
      .select(
        "id,slug,name,category,capacity,suggested_contribution_per_hour,short_description,how_to_use_url,photo_url,sort_order"
      )
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("spaces_settings")
      .select("key,value")
      .in("key", ["storefront_info_html", "donation_min_hours"]),
  ]);

  const spaces = (spacesRes.data ?? []) as Space[];
  const settings = (settingsRes.data ?? []) as Setting[];
  const s = new Map(settings.map((row) => [row.key, row.value]));

  const storefrontInfoHtml =
    (s.get("storefront_info_html") as string) ??
    "<p>Welcome. Use the form below to request space at our building.</p>";
  const donationMinHours = Number(s.get("donation_min_hours") ?? 2);

  return (
    <div className="min-h-screen flex flex-col">
      <MipSiteHeader />
      <main
        className="mx-auto w-full px-6 py-8 flex-1"
        style={{ maxWidth: "1200px" }}
      >
        {/* Admin-editable info panel. HTML comes from spaces_settings and is
            written through a TipTap editor in /admin/spaces/settings, so we
            trust the shape. */}
        <section
          className="mb-8 max-w-3xl space-y-4 text-mip-gray-700 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: storefrontInfoHtml }}
        />
        <Suspense fallback={null}>
          <SpacesBrowser
            spaces={spaces}
            donationMinHours={donationMinHours}
          />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

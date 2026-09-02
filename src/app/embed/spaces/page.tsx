import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { SpacesBrowser } from "@/app/spaces/spaces-browser";

// Iframe-embeddable version of the space selection UI. No site header,
// no info panel — just the search, filters, grid, and sticky Continue
// bar. The Continue button opens the reserve page in the top-level
// window (target="_top") so users leave the iframe when they proceed.
//
// CSP frame-ancestors for /embed/* is set in next.config.ts to
// movementinfrastructureproject.org and its subdomains.

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
  title: "Reserve a space — MIP",
  description: "Embedded space selection for the MIP building.",
  robots: { index: false, follow: false },
};

export default async function SpacesEmbedPage() {
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
      .in("key", ["donation_min_hours"]),
  ]);

  const spaces = (spacesRes.data ?? []) as Space[];
  const settings = (settingsRes.data ?? []) as Setting[];
  const s = new Map(settings.map((row) => [row.key, row.value]));
  const donationMinHours = Number(s.get("donation_min_hours") ?? 2);

  // Absolute origin so the top-level navigation lands on the real reserve
  // page, not on the embedder's origin. Falls back to the production URL.
  const reserveBaseUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    "https://app.movementinfrastructureproject.org"
  ).replace(/\/$/, "");

  return (
    <div className="mx-auto w-full px-4 py-4" style={{ maxWidth: "1200px" }}>
      <Suspense fallback={null}>
        <SpacesBrowser
          spaces={spaces}
          donationMinHours={donationMinHours}
          embed
          reserveBaseUrl={reserveBaseUrl}
        />
      </Suspense>
    </div>
  );
}

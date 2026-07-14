import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SubscribePanel } from "./subscribe-panel";

export const dynamic = "force-dynamic";

export default async function SubscribePage() {
  const supabase = await createClient();

  const { data: overlays } = await supabase
    .from("overlay_calendars")
    .select("id, name, slug, color")
    .order("sort_order");

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://mip-calendar.vercel.app";

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <main
        className="flex-1 mx-auto w-full px-6 py-10"
        style={{ maxWidth: "820px" }}
      >
        <h1
          className="mip-heading text-3xl md:text-4xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          Subscribe to the calendar
        </h1>
        <p className="mt-4 text-sm text-mip-gray-700 leading-relaxed">
          Add MIP events to the calendar app you already use. Your calendar will
          stay in sync automatically — as we add, update, or approve events,
          they'll show up in your calendar within an hour or so (depending on
          how often your calendar client refreshes).
        </p>

        <SubscribePanel siteUrl={siteUrl} overlays={overlays ?? []} />
      </main>

      <SiteFooter />
    </div>
  );
}

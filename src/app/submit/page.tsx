import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SubmitForm } from "./submit-form";

export const dynamic = "force-dynamic";

export default async function SubmitPage() {
  const supabase = await createClient();

  const [{ data: overlays }, { data: eventTypes }] = await Promise.all([
    supabase
      .from("overlay_calendars")
      .select("id, name, slug, color, sort_order")
      .order("sort_order"),
    supabase.from("event_types").select("id, name").order("sort_order"),
  ]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <main
        className="flex-1 mx-auto w-full px-6 py-10"
        style={{ maxWidth: "760px" }}
      >
        <h1
          className="mip-heading text-3xl md:text-4xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          Submit an event
        </h1>
        <p className="mt-4 text-sm text-mip-gray-700 leading-relaxed">
          Have something to add to the Movement Calendar? Fill out this form and
          an admin will review it within <strong>3 business days</strong>. You'll
          get an email confirming submission and another when it's approved.
        </p>
        <p className="mt-2 text-sm text-mip-gray-500">
          Fields marked * are required.
        </p>

        <SubmitForm
          overlays={overlays ?? []}
          eventTypes={eventTypes ?? []}
          turnstileSiteKey={siteKey}
        />
      </main>

      <SiteFooter />
    </div>
  );
}

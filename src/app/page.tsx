import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { FeaturedBar } from "@/components/featured-bar";
import { FeedView } from "@/components/feed-view";
import { SAMPLE_EVENTS } from "@/lib/sample-data";

export default function HomePage() {
  // TODO: replace with real Supabase query once schema is deployed.
  const now = new Date();
  const upcomingEvents = SAMPLE_EVENTS.filter(
    (e) => new Date(e.starts_at) >= now
  ).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const featuredEvents = upcomingEvents
    .filter((e) => {
      if (!e.is_featured) return false;
      if (e.featured_until && new Date(e.featured_until) < now) return false;
      return true;
    })
    .sort((a, b) => {
      const aOrder = a.featured_sort_order ?? 999;
      const bOrder = b.featured_sort_order ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.starts_at.localeCompare(b.starts_at);
    });

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <FeaturedBar events={featuredEvents} />

      <main
        className="flex-1 mx-auto w-full px-6 py-8"
        style={{ maxWidth: "var(--max-width-content)" }}
      >
        <div className="mb-6">
          <h1
            className="mip-heading text-4xl md:text-5xl mip-double-underline inline-block pb-2"
            style={{ color: "var(--color-mip-purple)" }}
          >
            Movement Calendar
          </h1>
          <p className="mt-4 text-mip-gray-700 max-w-3xl">
            A resource for our community — find ways to plug into actions and events,
            promote your action, and track important dates in our political and economic landscape.
          </p>
        </div>

        <div className="grid md:grid-cols-[240px_1fr] gap-8">
          {/* Placeholder for filters sidebar — coming next */}
          <aside className="hidden md:block">
            <div className="sticky top-24">
              <h3 className="mip-nav-text mb-3" style={{ color: "var(--color-mip-purple)" }}>
                Filters
              </h3>
              <p className="text-xs text-mip-gray-500">
                Overlay calendars and event type filters will appear here.
              </p>
            </div>
          </aside>

          <div>
            <div className="flex items-center gap-2 mb-6">
              <button
                className="mip-button-text px-3 py-1.5 bg-mip-purple text-mip-white"
                style={{ borderRadius: "var(--radius-button)" }}
              >
                Feed
              </button>
              <button
                className="mip-button-text px-3 py-1.5 text-mip-gray-700 hover:bg-mip-gray-100"
                style={{ borderRadius: "var(--radius-button)" }}
                disabled
                title="Coming soon"
              >
                Day
              </button>
              <button
                className="mip-button-text px-3 py-1.5 text-mip-gray-700 hover:bg-mip-gray-100"
                style={{ borderRadius: "var(--radius-button)" }}
                disabled
                title="Coming soon"
              >
                Week
              </button>
              <button
                className="mip-button-text px-3 py-1.5 text-mip-gray-700 hover:bg-mip-gray-100"
                style={{ borderRadius: "var(--radius-button)" }}
                disabled
                title="Coming soon"
              >
                Month
              </button>
            </div>

            <FeedView events={upcomingEvents} />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

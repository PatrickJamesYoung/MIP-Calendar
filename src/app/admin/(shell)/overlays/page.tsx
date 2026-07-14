import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OverlaysPage() {
  const supabase = await createClient();
  const { data: overlays } = await supabase
    .from("overlay_calendars")
    .select("*")
    .order("sort_order");

  return (
    <div>
      <h1
        className="mip-heading text-2xl mip-double-underline inline-block pb-1"
        style={{ color: "var(--color-mip-purple)" }}
      >
        Overlay Calendars
      </h1>
      <p className="mt-3 mb-6 text-sm text-mip-gray-700">
        Read-only for now. Editing coming soon.
      </p>

      <div className="border border-mip-gray-200" style={{ borderRadius: "var(--radius-button)" }}>
        {(overlays ?? []).map((o, i, arr) => (
          <div
            key={o.id}
            className={`flex items-center gap-3 p-3 ${i < arr.length - 1 ? "border-b border-mip-gray-200" : ""}`}
          >
            <span
              className="w-4 h-4 rounded-full inline-block shrink-0"
              style={{ backgroundColor: o.color }}
            />
            <div className="flex-1 min-w-0">
              <div className="mip-heading text-sm">{o.name}</div>
              <div className="text-xs text-mip-gray-500 font-mono">
                {o.slug} · {o.color} · sort {o.sort_order} ·{" "}
                {o.default_visible ? "visible by default" : "hidden by default"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

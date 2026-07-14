import { requireSuperAdmin } from "@/lib/auth";
import { ImportPanel } from "./import-panel";

export const dynamic = "force-dynamic";

/**
 * Trumba iCal import — super admins only.
 * Read-only preview + one-click confirm.
 */
export default async function ImportPage() {
  await requireSuperAdmin();
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1
        className="mip-heading text-3xl mip-double-underline inline-block pb-1"
        style={{ color: "var(--color-mip-purple)" }}
      >
        Trumba import
      </h1>
      <p className="mt-4 text-sm text-mip-gray-700">
        Pull upcoming events from{" "}
        <code className="text-xs bg-mip-gray-100 px-1 py-0.5 rounded">
          trumba.com/calendars/Reaction.ics
        </code>{" "}
        into this calendar. Runs are idempotent — re-running updates events in
        place using the Trumba event ID.
      </p>

      <ImportPanel />
    </div>
  );
}

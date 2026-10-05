import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/gear/notion-tasks", () => ({ createGearRequestTasks: vi.fn() }));
vi.mock("@/lib/gear/email", () => ({ sendGearTemplateEmail: vi.fn() }));
vi.mock("@/lib/spaces/email", () => ({ sendSpaceTemplateEmail: vi.fn() }));
vi.mock("@/lib/gear/notify", () => ({ notifyOrganizersOfNewGearRequest: vi.fn() }));
vi.mock("@/lib/spaces/notify", () => ({ notifyOrganizersOfNewSpaceRequest: vi.fn() }));
import { submitReservationAction } from "@/app/gear/reserve/actions";
import { submitSpaceReservationAction } from "@/app/spaces/reserve/actions";
import { headers } from "next/headers";

describe("reservation policy server validation", () => {
  it.each([undefined, "true", "2025-01-01"])("rejects missing or stale acknowledgement %s before external effects", async version => {
    const form = new FormData();
    const fields = {
      requester_name: "Test", requester_email: "test@example.org", org_tier: "full",
      event_title: "Test", event_description: "Test event", pickup_at: "2026-11-01T12:00",
      return_at: "2026-11-02T12:00", acknowledged_tentative: "true", cart: "speaker:1",
      spaces: "meeting-room", load_in_at: "2026-11-01T12:00",
      event_start_at: "2026-11-01T13:00", event_end_at: "2026-11-01T14:00",
      load_out_at: "2026-11-01T15:00",
    };
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    if (version) form.set("acknowledged_policies", version);
    for (const action of [submitReservationAction, submitSpaceReservationAction]) {
      const result = await action(form);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("acknowledged_policies");
    }
    expect(headers).not.toHaveBeenCalled();
  });
});

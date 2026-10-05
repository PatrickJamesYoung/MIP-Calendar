import { describe, expect, it } from "vitest";
import { safeAnalyticsUrl } from "./analytics-privacy";

describe("analytics privacy boundary", () => {
  it("strips query parameters and fragments even on public pages", () => {
    expect(safeAnalyticsUrl("https://mip.example/gear?answers=private#name"))
      .toBe("https://mip.example/gear");
  });
  it.each([
    "/admin", "/admin/quickbooks", "/admin/invoices/gear/G-123",
    "/admin/login?next=private", "/auth/callback?code=secret",
    "/api/quickbooks/callback?code=secret", "/gear/reserve?answers=private",
    "/spaces/reserve", "/gear/thanks/G-123", "/unknown",
  ])("blocks private or unknown path %s", path => {
    expect(safeAnalyticsUrl(`https://mip.example${path}`)).toBeNull();
  });
  it("rejects malformed URLs and non-web protocols", () => {
    expect(safeAnalyticsUrl("not-a-url")).toBeNull();
    expect(safeAnalyticsUrl("ftp://mip.example/gear")).toBeNull();
  });
});

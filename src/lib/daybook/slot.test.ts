import { describe, expect, it } from "vitest";
import { slotFor } from "./slot";

// Each vercel.json slot fires at two UTC times; exactly one must match.
describe("slotFor", () => {
  it("weekday EDT: 10:15Z dispatches, 11:15Z skips", () => {
    expect(slotFor(new Date("2026-09-30T10:15:00Z"))).toEqual({ edition: "daybook", publication_date: "2026-09-30" });
    expect(slotFor(new Date("2026-09-30T11:15:00Z"))).toBeNull();
  });
  it("weekday EST: 10:15Z skips, 11:15Z dispatches", () => {
    expect(slotFor(new Date("2026-12-02T10:15:00Z"))).toBeNull();
    expect(slotFor(new Date("2026-12-02T11:15:00Z"))).toEqual({ edition: "daybook", publication_date: "2026-12-02" });
  });
  it("Sunday EDT: 11:00Z weekly, 12:00Z skips", () => {
    expect(slotFor(new Date("2026-10-04T11:00:00Z"))).toEqual({ edition: "weekly", publication_date: "2026-10-04" });
    expect(slotFor(new Date("2026-10-04T12:00:00Z"))).toBeNull();
  });
  it("Sunday EST: 11:00Z skips, 12:00Z weekly", () => {
    expect(slotFor(new Date("2026-12-06T11:00:00Z"))).toBeNull();
    expect(slotFor(new Date("2026-12-06T12:00:00Z"))).toEqual({ edition: "weekly", publication_date: "2026-12-06" });
  });
  it("Saturday never dispatches", () => {
    expect(slotFor(new Date("2026-10-03T10:15:00Z"))).toBeNull();
    expect(slotFor(new Date("2026-10-03T11:15:00Z"))).toBeNull();
  });
});

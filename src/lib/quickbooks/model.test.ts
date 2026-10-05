import { describe, expect, it } from "vitest";
import { allocateCents, draftSchema, etDate, plusDays, reviewFingerprint, salesLines, slidingScale, type InvoiceSnapshot } from "./model";

const draft = {
  customerId: "", customerName: "Test organization", email: "billing@example.org",
  invoiceDate: "2026-10-05", dueDate: "2026-10-20", memo: "MIP test",
  lines: [{ description: "Speaker", quantity: 3, amount: 10 }],
};
describe("reservation invoice amounts and dates", () => {
  it("preserves sliding-scale totals without per-unit rounding drift", () => {
    expect(allocateCents([100, 100, 100], 100)).toEqual([33.34, 33.33, 33.33]);
  });
  it("supports hourly spaces and free items", () => {
    expect(allocateCents([125, 62.5, 0], 93.75)).toEqual([62.5, 31.25, 0]);
  });
  it("preserves cents over many allocations", () => {
    for (let total = 0; total < 100; total++) {
      const amounts = allocateCents([3, 7, 9, 0, 41], total / 100);
      expect(amounts.reduce((sum, n) => sum + Math.round(n * 100), 0)).toBe(total);
    }
  });
  it("does not invent charges when all lines are free", () => {
    expect(allocateCents([0, 0], 0)).toEqual([0, 0]);
    expect(() => allocateCents([0], 1)).toThrow();
    expect(() => allocateCents([-1], 1)).toThrow();
  });
  it("uses ET for invoice date, with Net 15 across DST and year boundaries", () => {
    expect(etDate(new Date("2026-10-06T02:00:00Z"))).toBe("2026-10-05");
    expect(plusDays("2026-10-25", 15)).toBe("2026-11-09");
    expect(plusDays("2026-12-25", 15)).toBe("2027-01-09");
  });
  it("rejects missing email, invalid dates, zero totals, and negative values", () => {
    expect(draftSchema.safeParse(draft).success).toBe(true);
    for (const value of [
      { ...draft, email: "" }, { ...draft, dueDate: "2026-02-31" },
      { ...draft, dueDate: "2026-01-01" },
      { ...draft, lines: [{ ...draft.lines[0], amount: 0 }] },
      { ...draft, lines: [{ ...draft.lines[0], amount: -1 }] },
      { ...draft, lines: [{ ...draft.lines[0], amount: 1.001 }] },
    ]) expect(draftSchema.safeParse(value).success).toBe(false);
  });
  it("retains a correct unit price when adjusted total is not divisible by quantity", () => {
    const line = salesLines(draft, "8", "NON")[0];
    expect(line.Amount).toBe(10);
    expect(Math.round(line.SalesItemLineDetail.UnitPrice * 3 * 100)).toBe(1000);
    expect(line.SalesItemLineDetail.ItemRef.value).toBe("8");
  });
  it("compares reviews independently of JSONB key ordering and detects amount/recipient changes", () => {
    const s: InvoiceSnapshot = {
      id: "1", number: "1001", syncToken: "0", total: 10, balance: 10,
      dueDate: "2026-10-20", email: "a@example.org", emailStatus: "NotSet",
      currency: "USD", cc: "", bcc: "", invoiceDate: "2026-10-05",
      customerName: "Test", memo: "Test", lines: [{ description: "Gear", amount: 10 }],
    };
    const reordered = Object.fromEntries(Object.entries(s).reverse()) as InvoiceSnapshot;
    expect(reviewFingerprint(s)).toBe(reviewFingerprint(reordered));
    expect(reviewFingerprint(s)).not.toBe(reviewFingerprint({ ...s, total: 11 }));
    expect(reviewFingerprint(s)).not.toBe(reviewFingerprint({ ...s, bcc: "other@example.org" }));
  });
});

describe("slidingScale", () => {
  it("explains a discounted tier on the memo and each line", () => {
    const s = slidingScale({ tier: "mid", multiplier: 0.85, listedTotal: 200, contribution: 170, label: "Small organization or coalition" })!;
    expect(s.memo).toContain("Tier 2 of 3 (Small organization or coalition), 85% of the listed rate");
    expect(s.memo).toContain("Listed rate $200.00; your sliding-scale contribution is $170.00");
    expect(s.format(40)).toBe(" (listed $40.00; Tier 2 rate, 85%)");
  });
  it("omits long form-style labels and line notes at the full rate", () => {
    const s = slidingScale({ tier: "full", multiplier: 1, listedTotal: 50, contribution: 50,
      label: "We're a larger or well-resourced organization and can contribute the amount listed." })!;
    expect(s.tierName).toBe("Tier 1 of 3");
    expect(s.memo).toContain("the full listed rate");
    expect(s.format(50)).toBe("");
  });
  it("returns null without a tier", () => {
    expect(slidingScale({ tier: null, multiplier: 1, listedTotal: 0, contribution: 0 })).toBeNull();
  });
});

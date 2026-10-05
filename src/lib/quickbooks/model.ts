import { z } from "zod";

export const kindSchema = z.enum(["gear", "spaces"]);
export type ReservationKind = z.infer<typeof kindSchema>;
export const idSchema = z.string().regex(/^\d+$/).max(30);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(v => {
    const d = new Date(`${v}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Use a valid date");
export const draftSchema = z.object({
  customerId: z.union([idSchema, z.literal("")]),
  customerName: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  invoiceDate: dateSchema,
  dueDate: dateSchema,
  memo: z.string().max(1000),
  lines: z.array(z.object({
    description: z.string().trim().min(1).max(500),
    quantity: z.number().finite().positive().max(100000),
    amount: z.number().finite().min(0).max(1000000)
      .refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001, "Use whole cents"),
  })).min(1).max(100),
}).refine(d => d.dueDate >= d.invoiceDate, "Due date cannot precede invoice date")
  .refine(d => d.lines.some(l => l.amount > 0), "An invoice must have a positive total");
export type InvoiceDraft = z.infer<typeof draftSchema>;
export type InvoiceSnapshot = {
  id: string; number: string; syncToken: string; total: number; balance: number;
  dueDate: string; email: string; emailStatus: string; currency: string;
  cc: string; bcc: string; invoiceDate: string; customerName: string; memo: string;
  lines: { description: string; amount: number }[];
};
/** JSONB changes object key order; compare a canonical representation instead. */
export function reviewFingerprint(s: InvoiceSnapshot): string {
  return JSON.stringify([s.id, s.number, s.syncToken, s.total, s.balance, s.dueDate,
    s.email, s.emailStatus, s.currency, s.cc, s.bcc, s.invoiceDate, s.customerName,
    s.memo, s.lines.map(l => [l.description, l.amount])]);
}
export function etDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}
export function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Largest-remainder allocation preserves the exact saved sliding-scale total. */
export function allocateCents(weights: number[], total: number): number[] {
  if (!weights.length || weights.some(w => !Number.isFinite(w) || w < 0) ||
      !Number.isFinite(total) || total < 0) throw new Error("Invalid reservation charges");
  const sum = weights.reduce((a, b) => a + b, 0);
  const cents = Math.round(total * 100);
  if (sum === 0) {
    if (cents !== 0) throw new Error("Reservation has a total but no priced lines. Correct it before invoicing.");
    return weights.map(() => 0);
  }
  const raw = weights.map(w => w / sum * cents);
  const amounts = raw.map(Math.floor);
  const remainder = cents - amounts.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, part: v - amounts[i] })).sort((a, b) => b.part - a.part);
  for (let i = 0; i < remainder; i++) amounts[order[i].i]++;
  return amounts.map(c => c / 100);
}

export function salesLines(draft: InvoiceDraft, itemId: string, taxCode: string) {
  return draft.lines.map(l => ({
    DetailType: "SalesItemLineDetail",
    Description: l.description,
    Amount: l.amount,
    SalesItemLineDetail: {
      ItemRef: { value: itemId }, TaxCodeRef: { value: taxCode },
      Qty: l.quantity, UnitPrice: Number((l.amount / l.quantity).toFixed(7)),
    },
  }));
}

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const TIER_NUMBER: Record<string, number> = { full: 1, mid: 2, low: 3 };

/**
 * Customer-facing explanation of MIP's three-tier sliding scale, printed on
 * the QuickBooks invoice. Uses the multiplier stored on the reservation (the
 * rate actually applied), not current settings. Returns null when the
 * reservation has no tier (e.g. calendar-imported space bookings).
 */
export function slidingScale(input: {
  tier: string | null | undefined; multiplier: number; listedTotal: number;
  contribution: number; label?: string | null;
}) {
  const n = input.tier ? TIER_NUMBER[input.tier] : undefined;
  if (!n || !Number.isFinite(input.multiplier)) return null;
  const pct = Math.round(input.multiplier * 100);
  // Gear labels are full sentences meant for the request form; only short labels read well on an invoice.
  const label = input.label && input.label.length <= 60 ? input.label.trim() : "";
  const tierName = `Tier ${n} of 3${label ? ` (${label})` : ""}`;
  const rate = pct === 100 ? "the full listed rate" : `${pct}% of the listed rate`;
  return {
    tierName,
    memo: `Sliding scale: ${tierName}, ${rate}. ` +
      (pct === 100 ? `Contribution: ${usd(input.contribution)}.` :
        `Listed rate ${usd(input.listedTotal)}; your sliding-scale contribution is ${usd(input.contribution)}.`) +
      " MIP uses a three-tier sliding scale so every group can access movement infrastructure.",
    format: (listedLine: number) => pct === 100 ? "" : ` (listed ${usd(listedLine)}; Tier ${n} rate, ${pct}%)`,
  };
}

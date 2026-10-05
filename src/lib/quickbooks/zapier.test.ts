import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authorizedCallback, buildZapierPayload, callbackSchema, postToZapier, snapshotFromCallback,
  zapierConfiguration, ZapierRejected } from "./zapier";
import type { InvoiceDraft } from "./model";

const secret = "s".repeat(40);
const draft: InvoiceDraft = {
  customerId: "", customerName: "DC Tenants Union", email: "pay@example.org",
  invoiceDate: "2026-10-05", dueDate: "2026-10-20", memo: "MIP-20261005-AB12: Rally",
  lines: [
    { description: "Wireless mic", quantity: 3, amount: 33.34 },
    { description: "PA speaker", quantity: 1, amount: 66.66 },
  ],
};
beforeEach(() => {
  vi.stubEnv("ZAPIER_INVOICE_WEBHOOK_URL", "https://hooks.zapier.com/hooks/catch/1/abc/");
  vi.stubEnv("ZAPIER_INVOICE_CALLBACK_SECRET", secret);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.movementinfrastructureproject.org");
});
afterEach(() => vi.unstubAllEnvs());

describe("zapier configuration", () => {
  it("requires a zapier.com https hook and a long secret", () => {
    expect(zapierConfiguration().callbackUrl).toBe("https://app.movementinfrastructureproject.org/api/zapier/invoice-callback");
    vi.stubEnv("ZAPIER_INVOICE_WEBHOOK_URL", "https://evil.example.com/zapier.com");
    expect(() => zapierConfiguration()).toThrow(/hooks.zapier.com/);
    vi.stubEnv("ZAPIER_INVOICE_WEBHOOK_URL", "https://hooks.zapier.com/x");
    vi.stubEnv("ZAPIER_INVOICE_CALLBACK_SECRET", "short");
    expect(() => zapierConfiguration()).toThrow(/CALLBACK_SECRET/);
  });
});

describe("payload", () => {
  const p = buildZapierPayload({ draft, kind: "gear", humanId: "MIP-20261005-AB12",
    invoiceRecordId: "rec", requestId: "req", callbackUrl: "cb", requestedBy: "a@b.org" });
  it("sends each line as qty 1 at the exact total so QuickBooks matches to the cent", () => {
    expect(p.line_items.map(l => [l.quantity, l.rate])).toEqual([[1, 33.34], [1, 66.66]]);
    expect(p.line_items[0].description).toBe("3 × Wireless mic");
    expect(p.subtotal).toBe(100);
  });
  it("uses the reservation ID as the QuickBooks invoice number", () => {
    expect(p.doc_number).toBe("MIP-20261005-AB12");
    expect(p.reservation_type_label).toBe("Gear rental");
  });
});

describe("postToZapier", () => {
  const payload = buildZapierPayload({ draft, kind: "spaces", humanId: "SPACE-1",
    invoiceRecordId: "r", requestId: "q", callbackUrl: "c", requestedBy: "a" });
  it("treats non-2xx as a rejection (no invoice created)", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 410 }));
    await expect(postToZapier(payload, f)).rejects.toBeInstanceOf(ZapierRejected);
  });
  it("treats network failure as unknown, not rejection", async () => {
    const f = vi.fn().mockRejectedValue(new Error("timeout"));
    const err = await postToZapier(payload, f).catch(e => e);
    expect(err).not.toBeInstanceOf(ZapierRejected);
    expect(err.message).toMatch(/may or may not/);
  });
  it("posts JSON to the hook", async () => {
    const f = vi.fn().mockResolvedValue(Response.json({ status: "success" }));
    await postToZapier(payload, f);
    expect(f.mock.calls[0][0]).toBe("https://hooks.zapier.com/hooks/catch/1/abc/");
    expect(JSON.parse(f.mock.calls[0][1].body).doc_number).toBe("SPACE-1");
  });
});

describe("callback", () => {
  it("authenticates with a constant-time bearer comparison", () => {
    expect(authorizedCallback(`Bearer ${secret}`)).toBe(true);
    expect(authorizedCallback(`Bearer ${secret}x`)).toBe(false);
    expect(authorizedCallback(null)).toBe(false);
  });
  it("coerces Zapier's string fields and requires an invoice id on success", () => {
    const ok = callbackSchema.parse({ request_id: "12345678-1234-4234-8234-123456789abc", invoice_id: 145, total: "100.00" });
    expect(ok.invoice_id).toBe("145");
    expect(ok.total).toBe(100);
    expect(callbackSchema.safeParse({ request_id: "12345678-1234-4234-8234-123456789abc" }).success).toBe(false);
    expect(callbackSchema.safeParse({ request_id: "12345678-1234-4234-8234-123456789abc", status: "failed", error: "x" }).success).toBe(true);
  });
  it("builds a snapshot from callback data", () => {
    const s = snapshotFromCallback(callbackSchema.parse({
      request_id: "12345678-1234-4234-8234-123456789abc", invoice_id: "145", doc_number: "MIP-20261005-AB12",
      due_date: "2026-10-20T00:00:00-04:00",
    }), draft);
    expect(s).toMatchObject({ id: "145", number: "MIP-20261005-AB12", total: 100, dueDate: "2026-10-20" });
  });
});

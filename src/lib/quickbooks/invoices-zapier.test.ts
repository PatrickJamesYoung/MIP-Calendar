import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ row: {} as Record<string, unknown>, audits: [] as string[] }));
vi.mock("./client", () => ({
  QuickBooksError: class extends Error {}, connection: vi.fn(), qbo: vi.fn(), queryLiteral: (s: string) => s,
  withLock: async (_r: string, fn: () => Promise<unknown>) => fn(),
  db: () => ({
    from: (table: string) => {
      let patch: Record<string, unknown> | undefined;
      let inserted: Record<string, unknown> | undefined;
      const chain = {
        select: () => chain, eq: () => chain,
        update: (v: Record<string, unknown>) => { patch = v; return chain; },
        insert: (v: Record<string, unknown>) => { inserted = v; return chain; },
        single: async () => table.endsWith("_reservations")
          ? { data: { human_id: "MIP-20261005-AB12" }, error: null }
          : { data: structuredClone(m.row), error: null },
        maybeSingle: async () => ({ data: structuredClone(m.row), error: null }),
        then: (resolve: (r: unknown) => unknown) => {
          if (patch && table === "reservation_invoices") Object.assign(m.row, structuredClone(patch));
          if (inserted && table === "qbo_invoice_activity") m.audits.push(String(inserted.action));
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return chain;
    },
  }),
}));
import { applyZapierCallback, createInvoice } from "./invoices";

const id = "12345678-1234-4234-8234-123456789abc";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("ZAPIER_INVOICE_WEBHOOK_URL", "https://hooks.zapier.com/hooks/catch/1/abc/");
  vi.stubEnv("ZAPIER_INVOICE_CALLBACK_SECRET", "s".repeat(40));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset(); m.audits = [];
  m.row = {
    id, revision: 2, status: "draft", gear_reservation_id: "g1", spaces_reservation_id: null,
    qbo_invoice_id: null, create_payload: null, create_request_id: null, snapshot: null,
    draft: { customerId: "", customerName: "Org", email: "a@example.org", invoiceDate: "2026-10-05",
      dueDate: "2026-10-20", memo: "m", lines: [{ description: "Mic", quantity: 2, amount: 40 }] },
  };
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Zapier invoice flow", () => {
  it("button sends to Zapier and stays pending until the callback", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "success" }));
    const row = await createInvoice(id, 2, "admin@mip.org");
    expect(row.status).toBe("creating");
    expect(row.qbo_invoice_id).toBeNull();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.doc_number).toBe("MIP-20261005-AB12");
    expect(sent.request_id).toBe(row.create_request_id);
    expect(m.audits).toContain("invoice_requested_via_zapier");
  });
  it("resend reuses the frozen request ID and payload", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "success" }));
    const first = await createInvoice(id, 2, "a");
    await createInvoice(id, 99, "a");
    const bodies = fetchMock.mock.calls.map(c => JSON.parse(c[1].body));
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[1].request_id).toBe(first.create_request_id);
  });
  it("a Zapier rejection returns the record to draft", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 410 }));
    await expect(createInvoice(id, 2, "a")).rejects.toThrow(/rejected/);
    expect(m.row.status).toBe("draft");
    expect(m.row.create_request_id).toBeNull();
  });
  it("a network failure keeps the request pending for safe resend", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(createInvoice(id, 2, "a")).rejects.toThrow(/may or may not/);
    expect(m.row.status).toBe("creating");
  });
  it("callback links the QuickBooks invoice; a second different ID is flagged, not overwritten", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "success" }));
    const row = await createInvoice(id, 2, "a");
    const rid = row.create_request_id!;
    const r1 = await applyZapierCallback({ request_id: rid, status: "created", invoice_id: "145", doc_number: "MIP-20261005-AB12", total: 40 });
    expect(r1.matched && r1.row.status).toBe("created");
    expect(m.row.qbo_invoice_id).toBe("145");
    await applyZapierCallback({ request_id: rid, status: "created", invoice_id: "146" });
    expect(m.row.qbo_invoice_id).toBe("145");
    expect(String(m.row.last_error)).toMatch(/second QuickBooks invoice/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  qbo: vi.fn(), connection: vi.fn(), row: {} as Record<string, unknown>,
  lock: false, failSave: false,
}));
vi.mock("./client", () => ({
  QuickBooksError: class extends Error { get rejectedWithoutWrite() { return true; } },
  connection: mocks.connection, qbo: mocks.qbo,
  queryLiteral: (s: string) => s.replace(/'/g, "\\'"),
  withLock: async (_resource: string, fn: () => Promise<unknown>) => {
    if (mocks.lock) throw new Error("Another operation is running");
    return fn();
  },
  db: () => ({
    from: (table: string) => {
      let patch: Record<string, unknown> | undefined;
      const chain = {
        select: () => chain, eq: () => chain,
        update: (v: Record<string, unknown>) => { patch = v; return chain; },
        insert: () => chain,
        single: async () => ({ data: structuredClone(mocks.row), error: null }),
        then: (resolve: (r: unknown) => unknown) => {
          if (patch && table === "reservation_invoices") {
            if (mocks.failSave && patch.qbo_invoice_id) {
              mocks.failSave = false;
              return Promise.resolve(resolve({ error: { message: "DB unavailable" } }));
            }
            Object.assign(mocks.row, structuredClone(patch));
          }
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return chain;
    },
  }),
}));
import { createInvoice, refreshInvoice, saveDraft, sendInvoice } from "./invoices";
import type { InvoiceSnapshot } from "./model";
const id = "12345678-1234-4234-8234-123456789abc";
const provider = () => ({
  Id: "22", DocNumber: "1002", SyncToken: "0", TotalAmt: 50, Balance: 50,
  DueDate: "2026-10-20", TxnDate: "2026-10-05", BillEmail: { Address: "test@example.org" },
  EmailStatus: "NotSet", CurrencyRef: { value: "USD" }, Line: [],
});
beforeEach(() => {
  mocks.qbo.mockReset(); mocks.connection.mockReset();
  mocks.lock = false; mocks.failSave = false;
  mocks.connection.mockResolvedValue({
    enabled: true, auto_send_disabled_confirmed: true, realm_id: "123", environment: "sandbox",
    gear_item_id: "9", spaces_item_id: "10", gear_tax_code: "NON", spaces_tax_code: "NON",
  });
  mocks.row = {
    id, status: "draft", revision: 1, gear_reservation_id: id, spaces_reservation_id: null,
    draft: { customerId: "5", customerName: "Org", email: "test@example.org", invoiceDate: "2026-10-05",
      dueDate: "2026-10-20", memo: "test", lines: [{ description: "Speaker", quantity: 1, amount: 50 }] },
    qbo_invoice_id: null, create_payload: null, create_started_at: null, create_request_id: null,
    send_request_id: null, send_started_at: null, snapshot: null,
  };
  mocks.qbo.mockImplementation(async (path: string) => path.startsWith("customer/")
    ? { Customer: { Id: "5", Active: true, CurrencyRef: { value: "USD" } } }
    : { Invoice: provider() });
});
describe("invoice external-write safety", () => {
  it("creates exactly once and returns the linked invoice on repeat", async () => {
    await createInvoice(id, 1, "admin@example.org");
    await createInvoice(id, 1, "admin@example.org");
    expect(mocks.qbo.mock.calls.filter(([path]) => path === "invoice")).toHaveLength(1);
  });
  it("retries a lost response using exactly the same request ID and frozen payload", async () => {
    mocks.qbo.mockImplementationOnce(async () => ({ Customer: { Id: "5" } }))
      .mockImplementationOnce(async () => { throw new Error("timeout"); });
    await expect(createInvoice(id, 1, "admin")).rejects.toThrow("timeout");
    expect(mocks.row.status).toBe("creating");
    await createInvoice(id, 1, "admin");
    const calls = mocks.qbo.mock.calls.filter(([path]) => path === "invoice");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
  });
  it("recovers if provider creation succeeds but linking the ID fails", async () => {
    mocks.failSave = true;
    await expect(createInvoice(id, 1, "admin")).rejects.toThrow("save invoice state");
    await createInvoice(id, 1, "admin");
    const calls = mocks.qbo.mock.calls.filter(([path]) => path === "invoice");
    expect(calls[0]).toEqual(calls[1]);
  });
  it("blocks a stale draft and concurrent operations before external writes", async () => {
    await expect(createInvoice(id, 2, "admin")).rejects.toThrow("Draft changed");
    mocks.lock = true;
    await expect(createInvoice(id, 1, "admin")).rejects.toThrow("Another operation");
    expect(mocks.qbo).not.toHaveBeenCalled();
  });
  it("blocks the wrong company and unconfirmed automatic-email settings", async () => {
    mocks.row.realm_id = "999";
    await expect(createInvoice(id, 1, "admin")).rejects.toThrow("different QuickBooks company");
    mocks.row.realm_id = null;
    mocks.connection.mockResolvedValue({ enabled: true, auto_send_disabled_confirmed: false });
    await expect(createInvoice(id, 1, "admin")).rejects.toThrow("disabling automatic sending");
  });
  it("does not let a submitted draft change", async () => {
    await createInvoice(id, 1, "admin");
    await expect(saveDraft(id, 1, mocks.row.draft, "admin")).rejects.toThrow("locked");
  });
  it("requires a fresh review if QBO amounts or recipients changed", async () => {
    const row = await createInvoice(id, 1, "admin");
    mocks.qbo.mockResolvedValue({ Invoice: { ...provider(), TotalAmt: 55, SyncToken: "1" } });
    await expect(sendInvoice(id, row.snapshot!, "admin")).rejects.toThrow("invoice changed");
    expect(mocks.qbo.mock.calls.some(([path]) => path.includes("/send"))).toBe(false);
  });
  it("sends only after review and will not implicitly resend", async () => {
    const row = await createInvoice(id, 1, "admin");
    mocks.qbo.mockImplementation(async (path: string) => ({
      Invoice: { ...provider(), EmailStatus: path.includes("/send") ? "EmailSent" : "NotSet" },
    }));
    await sendInvoice(id, row.snapshot!, "admin");
    await sendInvoice(id, row.snapshot!, "admin");
    expect(mocks.qbo.mock.calls.filter(([path]) => path.includes("/send"))).toHaveLength(1);
  });
  it("detects already-sent invoices after an ambiguous send timeout", async () => {
    const row = await createInvoice(id, 1, "admin");
    mocks.qbo.mockResolvedValue({ Invoice: { ...provider(), EmailStatus: "EmailSent" } });
    const sent = await sendInvoice(id, row.snapshot!, "admin");
    expect(sent.status).toBe("sent");
    expect(mocks.qbo.mock.calls.some(([path]) => path.includes("/send"))).toBe(false);
  });
  it("refreshes partial-payment balance without changing the invoice", async () => {
    await createInvoice(id, 1, "admin");
    mocks.qbo.mockResolvedValue({ Invoice: { ...provider(), Balance: 10 } });
    const row = await refreshInvoice(id);
    expect((row.snapshot as InvoiceSnapshot).balance).toBe(10);
  });
  it("detects unexpected automatic emailing during creation", async () => {
    mocks.qbo.mockImplementation(async (path: string) => path.startsWith("customer/")
      ? { Customer: { Id: "5" } } : { Invoice: { ...provider(), EmailStatus: "EmailSent" } });
    const row = await createInvoice(id, 1, "admin");
    expect(row.status).toBe("sent");
    expect(row.last_error).toContain("automatically sent");
  });
});

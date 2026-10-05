import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { connection, db, qbo, queryLiteral, QuickBooksError, withLock } from "./client";
import { allocateCents, draftSchema, etDate, idSchema, plusDays, reviewFingerprint, salesLines,
  type InvoiceDraft, type InvoiceSnapshot, type ReservationKind } from "./model";

export type InvoiceRow = {
  id: string; draft: InvoiceDraft; revision: number;
  status: "draft" | "creating" | "created" | "sending" | "sent";
  realm_id: string | null; environment: string | null;
  create_request_id: string | null; send_request_id: string | null;
  create_started_at: string | null; send_started_at: string | null;
  create_payload: Record<string, unknown> | null;
  qbo_invoice_id: string | null; snapshot: InvoiceSnapshot | null;
  sent_at: string | null; last_error: string | null;
  gear_reservation_id: string | null; spaces_reservation_id: string | null;
};
type Customer = {
  Id: string; DisplayName: string; Active?: boolean;
  PrimaryEmailAddr?: { Address: string }; CurrencyRef?: { value: string };
};
type ProviderInvoice = {
  Id: string; DocNumber?: string; SyncToken: string; TotalAmt: number; Balance: number;
  DueDate: string; BillEmail?: { Address: string }; EmailStatus?: string;
  CurrencyRef?: { value: string };
  BillEmailCc?: { Address: string }; BillEmailBcc?: { Address: string };
  TxnDate?: string; CustomerRef?: { name?: string }; CustomerMemo?: { value?: string };
  Line?: { Description?: string; Amount?: number; DetailType?: string }[];
};
async function patch(id: string, values: Record<string, unknown>) {
  const { error } = await db().from("reservation_invoices").update({
    ...values, updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error("Could not save invoice state. Do not create a replacement; retry this invoice.");
}
export async function readInvoice(id: string): Promise<InvoiceRow> {
  z.uuid().parse(id);
  const { data, error } = await db().from("reservation_invoices").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Invoice record not found.");
  return data as InvoiceRow;
}
function snapshot(i: ProviderInvoice): InvoiceSnapshot {
  if (!i?.Id || typeof i.SyncToken !== "string" || !Number.isFinite(i.TotalAmt) || !Number.isFinite(i.Balance))
    throw new Error("QuickBooks returned an incomplete invoice. Refresh before proceeding.");
  return {
    id: i.Id, number: i.DocNumber || i.Id, syncToken: i.SyncToken,
    total: i.TotalAmt, balance: i.Balance, dueDate: i.DueDate,
    email: i.BillEmail?.Address || "", emailStatus: i.EmailStatus || "NotSet",
    currency: i.CurrencyRef?.value || "USD",
    cc: i.BillEmailCc?.Address || "", bcc: i.BillEmailBcc?.Address || "",
    invoiceDate: i.TxnDate || "", customerName: i.CustomerRef?.name || "",
    memo: i.CustomerMemo?.value || "",
    lines: (i.Line || []).filter(l => l.DetailType !== "SubTotalLineDetail")
      .map(l => ({ description: l.Description || l.DetailType || "Line", amount: Number(l.Amount || 0) })),
  };
}
async function activeConnection(row?: InvoiceRow) {
  const c = await connection();
  if (!c?.enabled || !c.auto_send_disabled_confirmed)
    throw new Error("A super admin must confirm MIP QuickBooks, including disabling automatic sending, in settings.");
  if (row?.realm_id && (row.realm_id !== c.realm_id || row.environment !== c.environment))
    throw new Error("This invoice belongs to a different QuickBooks company or environment.");
  return c;
}
async function audit(row: InvoiceRow, actor: string, action: string) {
  const { error } = await db().from("qbo_invoice_activity").insert({
    invoice_id: row.id, actor_email: actor, action,
  });
  if (error) console.error("[qbo] invoice activity write failed", row.id);
}

/** Opening this authenticated page creates only a local draft, never a QBO invoice. */
export async function loadReservationInvoice(kind: ReservationKind, humanId: string, actor: string) {
  const prefix = kind === "gear" ? "gear" : "spaces";
  const { data: r, error } = await db().from(`${prefix}_reservations`).select("*").eq("human_id", humanId).single();
  if (error || !r) throw new Error("Reservation not found.");
  const foreignKey = `${prefix}_reservation_id`;
  const current = await db().from("reservation_invoices").select("*").eq(foreignKey, r.id).maybeSingle();
  if (current.error) throw new Error("QuickBooks database setup is missing or unavailable. Apply migration 0111.");
  if (current.data) return { row: current.data as InvoiceRow, title: humanId };
  const { data: lines, error: lineError } = await db().from(`${prefix}_reservation_lines`)
    .select("*").eq("reservation_id", r.id).order("id");
  if (lineError || !lines?.length) throw new Error("This reservation has no invoiceable lines.");
  const amounts = allocateCents(lines.map(l => Number(l.line_full ?? 0)), Number(r.contribution_total ?? 0));
  const today = etDate();
  const draft: InvoiceDraft = {
    customerId: "", customerName: String(r.organization || r.requester_name || "").slice(0, 100),
    email: r.requester_email || "", invoiceDate: today, dueDate: plusDays(today, 15),
    memo: `${humanId}${r.event_title ? `: ${r.event_title}` : ""}`.slice(0, 1000),
    lines: lines.map((l, i) => ({
      description: `${l.name_snapshot}${kind === "spaces" ? " (hours)" : ""}`.slice(0, 500),
      quantity: Number(kind === "gear" ? l.quantity : l.hours_billed) || 1, amount: amounts[i],
    })),
  };
  const { error: insertError } = await db().from("reservation_invoices")
    .upsert({ [foreignKey]: r.id, draft, created_by: actor },
      { onConflict: foreignKey, ignoreDuplicates: true });
  if (insertError) throw new Error("Could not create the local invoice draft.");
  const saved = await db().from("reservation_invoices").select("*").eq(foreignKey, r.id).single();
  if (saved.error) throw new Error("Could not load the saved draft.");
  return { row: saved.data as InvoiceRow, title: humanId };
}

export async function saveDraft(id: string, revision: number, input: unknown, actor: string) {
  const draft = draftSchema.parse(input);
  return withLock(`invoice:${id}`, async () => {
    const row = await readInvoice(id);
    if (row.status !== "draft") throw new Error("This draft has already been submitted to QuickBooks and is locked.");
    if (row.revision !== revision) throw new Error("Another admin changed this draft. Reload before saving.");
    await patch(id, { draft, revision: revision + 1, last_error: null });
    await audit(row, actor, "draft_saved");
    return readInvoice(id);
  });
}
export async function searchCustomers(search: string) {
  await activeConnection();
  const text = z.string().trim().min(2).max(80).parse(search);
  const query = `select * from Customer where Active = true and DisplayName LIKE '%${queryLiteral(text.replace(/[%_]/g, ""))}%' maxresults 30`;
  const result = await qbo<{ QueryResponse: { Customer?: Customer[] } }>(`query?query=${encodeURIComponent(query)}`);
  return (result.QueryResponse.Customer || []).map(c => ({
    id: c.Id, name: c.DisplayName, email: c.PrimaryEmailAddr?.Address || "",
  }));
}
async function customerFor(row: InvoiceRow) {
  const d = draftSchema.parse(row.draft);
  if (d.customerId) {
    const { Customer } = await qbo<{ Customer: Customer }>(`customer/${idSchema.parse(d.customerId)}`);
    if (!Customer || Customer.Active === false) throw new Error("Selected QuickBooks customer is no longer active.");
    if (Customer.CurrencyRef && Customer.CurrencyRef.value !== "USD")
      throw new Error("This portal currently supports USD customers only.");
    return Customer.Id;
  }
  // Stable identity and provider request ID make retries safe without changing existing customers.
  const name = `${d.customerName.slice(0, 60)} [${row.id.slice(0, 8)}]`;
  const query = `select * from Customer where DisplayName = '${queryLiteral(name)}' maxresults 2`;
  const matches = await qbo<{ QueryResponse: { Customer?: Customer[] } }>(`query?query=${encodeURIComponent(query)}`);
  const existing = matches.QueryResponse.Customer?.[0];
  if (existing) {
    if (existing.Active === false || existing.PrimaryEmailAddr?.Address?.toLowerCase() !== d.email.toLowerCase())
      throw new Error("A customer with this generated name already exists with different details. Ask a super admin to reconcile.");
    return existing.Id;
  }
  const { Customer } = await qbo<{ Customer: Customer }>("customer", {
    DisplayName: name, CompanyName: d.customerName,
    PrimaryEmailAddr: { Address: d.email }, CurrencyRef: { value: "USD" },
  }, `cust-${row.id}`);
  if (!Customer?.Id) throw new Error("QuickBooks did not return a customer ID.");
  return Customer.Id;
}
function retryWindow(started: string | null) {
  // Stop retries before provider idempotency retention can become uncertain.
  if (started && Date.now() - Date.parse(started) > 23 * 3600000)
    throw new Error("This operation is unresolved after 23 hours. Reconcile it before retrying; no replacement invoice was created.");
}
export async function createInvoice(id: string, revision: number, actor: string) {
  return withLock(`invoice:${id}`, async () => {
    let row = await readInvoice(id);
    const firstAttempt = row.status === "draft";
    const c = await activeConnection(row);
    if (row.qbo_invoice_id) return row;
    if (!["draft", "creating"].includes(row.status)) throw new Error("Invoice is not ready to create.");
    if (row.revision !== revision) throw new Error("Draft changed. Review the latest saved version.");
    const draft = draftSchema.parse(row.draft);
    const kind = row.gear_reservation_id ? "gear" : "spaces";
    const itemId = c[`${kind}_item_id`];
    const taxCode = c[`${kind}_tax_code`];
    if (!itemId || !taxCode) throw new Error("Configure QuickBooks items and tax treatment first.");
    retryWindow(row.create_started_at);
    try {
      if (row.status === "draft") {
        await patch(id, {
          status: "creating", realm_id: c.realm_id, environment: c.environment,
          create_request_id: randomUUID(), create_started_at: new Date().toISOString(),
        });
        row = await readInvoice(id);
      }
      if (!row.create_payload) {
        const customerId = await customerFor(row);
        // Persist the exact payload BEFORE the external write. Never regenerate it on retry.
        const payload = {
          CustomerRef: { value: customerId }, BillEmail: { Address: draft.email },
          TxnDate: draft.invoiceDate, DueDate: draft.dueDate,
          CustomerMemo: { value: draft.memo }, PrivateNote: `MIP portal invoice ${row.id}`,
          CurrencyRef: { value: "USD" }, Line: salesLines(draft, itemId, taxCode),
          EmailStatus: "NotSet",
        };
        await patch(id, { create_payload: payload });
        row = await readInvoice(id);
      }
      const { Invoice } = await qbo<{ Invoice: ProviderInvoice }>("invoice", row.create_payload, row.create_request_id!);
      const saved = snapshot(Invoice);
      await patch(id, { qbo_invoice_id: saved.id, snapshot: saved,
        status: saved.emailStatus === "EmailSent" ? "sent" : "created",
        last_error: saved.emailStatus === "EmailSent"
          ? "QuickBooks automatically sent this invoice during creation. Disable automatic sending in QuickBooks before creating more invoices."
          : null });
      if (saved.emailStatus === "EmailSent") {
        await db().from("qbo_connection").update({ enabled: false, auto_send_disabled_confirmed: false }).eq("id", true);
      }
      await audit(row, actor, "invoice_created_in_quickbooks");
      return readInvoice(id);
    } catch (e) {
      // A received validation/auth rejection means no invoice was created.
      // Unknown/timeout/DB-link failures retain the exact request for recovery.
      const reset = firstAttempt && e instanceof QuickBooksError && e.rejectedWithoutWrite;
      await patch(id, {
        last_error: (e as Error).message,
        ...(reset ? { status: "draft", create_payload: null, create_request_id: null, create_started_at: null } : {}),
      });
      throw e;
    }
  });
}
async function pullSnapshot(row: InvoiceRow) {
  if (!row.qbo_invoice_id) throw new Error("Create the invoice first.");
  const { Invoice } = await qbo<{ Invoice: ProviderInvoice }>(`invoice/${idSchema.parse(row.qbo_invoice_id)}`);
  return snapshot(Invoice);
}
export async function refreshInvoice(id: string) {
  return withLock(`invoice:${id}`, async () => {
    const row = await readInvoice(id);
    await activeConnection(row);
    const fresh = await pullSnapshot(row);
    await patch(id, {
      snapshot: fresh, last_error: null,
      ...(fresh.emailStatus === "EmailSent" ? { status: "sent" } : {}),
    });
    return readInvoice(id);
  });
}
export async function sendInvoice(id: string, reviewed: InvoiceSnapshot, actor: string) {
  return withLock(`invoice:${id}`, async () => {
    let row = await readInvoice(id);
    await activeConnection(row);
    if (!row.qbo_invoice_id || !["created", "sending", "sent"].includes(row.status))
      throw new Error("Create and review the QuickBooks invoice first.");
    const fresh = await pullSnapshot(row);
    if (row.status === "sent" || fresh.emailStatus === "EmailSent") {
      await patch(id, { status: "sent", snapshot: fresh, last_error: null });
      return readInvoice(id); // Never re-send implicitly.
    }
    // Validate the complete reviewed snapshot, including tax and outstanding balance.
    if (!reviewed || reviewFingerprint(fresh) !== reviewFingerprint(reviewed)) {
      await patch(id, { snapshot: fresh });
      throw new Error("QuickBooks invoice changed. Refresh and review the current invoice before sending.");
    }
    if (fresh.balance <= 0 || fresh.total <= 0) throw new Error("This invoice has no outstanding balance.");
    if (fresh.currency !== "USD") throw new Error("Only USD invoices are supported.");
    z.email().parse(fresh.email);
    retryWindow(row.send_started_at);
    try {
      if (!row.send_request_id) {
        await patch(id, {
          status: "sending", send_request_id: randomUUID(), send_started_at: new Date().toISOString(),
        });
        row = await readInvoice(id);
      }
      const { Invoice } = await qbo<{ Invoice: ProviderInvoice }>(
        `invoice/${row.qbo_invoice_id}/send?sendTo=${encodeURIComponent(fresh.email)}`, null, row.send_request_id!);
      const sent = snapshot(Invoice);
      if (sent.emailStatus !== "EmailSent") throw new Error("QuickBooks did not confirm sending. Refresh status before retrying.");
      await patch(id, { status: "sent", snapshot: sent, sent_at: new Date().toISOString(), last_error: null });
      await audit(row, actor, "invoice_sent_via_quickbooks");
      return readInvoice(id);
    } catch (e) {
      await patch(id, { last_error: (e as Error).message });
      throw e;
    }
  });
}

export async function verifyInvoiceCompany(row: InvoiceRow) { await activeConnection(row); }

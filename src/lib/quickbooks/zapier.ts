import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { InvoiceDraft, InvoiceSnapshot, ReservationKind } from "./model";

/**
 * Zapier transport for QuickBooks invoicing.
 *
 * Portal → Zapier "Catch Hook" (create request) → QuickBooks (via Zapier's
 * managed connection) → Zapier "POST" back to /api/zapier/invoice-callback.
 *
 * Zapier's Catch Hook reply only acknowledges receipt; it is NOT proof an
 * invoice exists. The portal marks an invoice created only after the
 * authenticated callback reports the QuickBooks invoice ID.
 */
export function zapierEnabled(): boolean {
  return !!process.env.ZAPIER_INVOICE_WEBHOOK_URL;
}

export function zapierConfiguration() {
  const webhookUrl = process.env.ZAPIER_INVOICE_WEBHOOK_URL || "";
  const callbackSecret = process.env.ZAPIER_INVOICE_CALLBACK_SECRET || "";
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://app.movementinfrastructureproject.org").replace(/\/$/, "");
  let host = "";
  try { host = new URL(webhookUrl).hostname; } catch { /* handled below */ }
  if (!webhookUrl.startsWith("https://") || !/(^|\.)zapier\.com$/.test(host))
    throw new Error("Zapier invoicing is misconfigured: ZAPIER_INVOICE_WEBHOOK_URL must be an https://hooks.zapier.com URL.");
  if (callbackSecret.length < 32)
    throw new Error("Zapier invoicing is misconfigured: set ZAPIER_INVOICE_CALLBACK_SECRET (32+ characters).");
  return { webhookUrl, callbackSecret, callbackUrl: `${siteUrl}/api/zapier/invoice-callback` };
}

export type ZapierInvoicePayload = ReturnType<typeof buildZapierPayload>;

/**
 * Flat, Zapier-friendly payload. Each line is sent as quantity 1 at the exact
 * line total so QuickBooks reproduces the saved sliding-scale amount to the
 * cent (Qty × Rate rounding cannot drift). The original quantity is kept in
 * the description (prefixed, e.g. "3 × Wireless mic") and as a separate field.
 */
export function buildZapierPayload(args: {
  draft: InvoiceDraft; kind: ReservationKind; humanId: string;
  invoiceRecordId: string; requestId: string; callbackUrl: string; requestedBy: string;
}) {
  const { draft, kind, humanId } = args;
  const subtotal = Math.round(draft.lines.reduce((s, l) => s + l.amount * 100, 0)) / 100;
  return {
    action: "create_invoice" as const,
    request_id: args.requestId,
    invoice_record_id: args.invoiceRecordId,
    reservation_kind: kind,
    reservation_type_label: kind === "gear" ? "Gear rental" : "Space rental",
    reservation_id: humanId,
    // QuickBooks DocNumber (≤21 chars). The Zap uses it to find an existing
    // invoice before creating, which makes a resend safe from duplicates.
    doc_number: humanId.slice(0, 21),
    customer_name: draft.customerName,
    customer_email: draft.email,
    existing_customer_id: draft.customerId || "",
    invoice_date: draft.invoiceDate,
    due_date: draft.dueDate,
    customer_memo: draft.memo,
    private_note: `MIP portal invoice ${args.invoiceRecordId} (${humanId}) requested by ${args.requestedBy}`,
    currency: "USD",
    subtotal,
    line_count: draft.lines.length,
    line_items: draft.lines.map(l => ({
      description: l.quantity !== 1
        ? `${Number(l.quantity.toFixed(4))} × ${l.description}`.slice(0, 500)
        : l.description,
      quantity: 1,
      rate: l.amount,
      amount: l.amount,
      original_quantity: l.quantity,
    })),
    callback_url: args.callbackUrl,
  };
}

export class ZapierRejected extends Error {}

/** Returns on a 2xx acknowledgment. Non-2xx means Zapier did not accept the run. */
export async function postToZapier(payload: ZapierInvoicePayload, fetchImpl: typeof fetch = fetch) {
  const { webhookUrl } = zapierConfiguration();
  let res: Response;
  try {
    res = await fetchImpl(webhookUrl, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Unknown whether Zapier received it. Keep the request for a safe resend.
    throw new Error("No response from Zapier. The request may or may not have been received; check Zap history, then resend (the Zap skips existing invoice numbers).");
  }
  if (!res.ok) throw new ZapierRejected(`Zapier rejected the request (HTTP ${res.status}). No invoice was created. Check that the Zap is turned on.`);
  return res.json().catch(() => ({}));
}

export const callbackSchema = z.object({
  request_id: z.uuid(),
  status: z.enum(["created", "failed"]).default("created"),
  invoice_id: z.coerce.string().regex(/^\d+$/).max(30).optional(),
  doc_number: z.coerce.string().max(21).optional(),
  total: z.coerce.number().finite().min(0).optional(),
  balance: z.coerce.number().finite().min(0).optional(),
  due_date: z.string().optional(),
  invoice_date: z.string().optional(),
  email_status: z.string().max(40).optional(),
  customer_name: z.string().max(200).optional(),
  error: z.string().max(1000).optional(),
}).refine(v => v.status === "failed" || !!v.invoice_id, "invoice_id is required when status is created");
export type ZapierCallback = z.infer<typeof callbackSchema>;

export function authorizedCallback(header: string | null): boolean {
  const secret = process.env.ZAPIER_INVOICE_CALLBACK_SECRET || "";
  if (secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const dateOr = (v: string | undefined, fallback: string) =>
  v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : fallback;

/** Snapshot assembled from the Zap's callback plus the frozen request. */
export function snapshotFromCallback(cb: ZapierCallback, draft: InvoiceDraft): InvoiceSnapshot {
  const subtotal = Math.round(draft.lines.reduce((s, l) => s + l.amount * 100, 0)) / 100;
  const total = cb.total ?? subtotal;
  return {
    id: cb.invoice_id!, number: cb.doc_number || cb.invoice_id!, syncToken: "",
    total, balance: cb.balance ?? total,
    dueDate: dateOr(cb.due_date, draft.dueDate), invoiceDate: dateOr(cb.invoice_date, draft.invoiceDate),
    email: draft.email, emailStatus: cb.email_status || "NotSet", currency: "USD",
    cc: "", bcc: "", customerName: cb.customer_name || draft.customerName, memo: draft.memo,
    lines: draft.lines.map(l => ({ description: l.description, amount: l.amount })),
  };
}

export function quickBooksInvoiceUrl(invoiceId: string) {
  return `https://qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(invoiceId)}`;
}

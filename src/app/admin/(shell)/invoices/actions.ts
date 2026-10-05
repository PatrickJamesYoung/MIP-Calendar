"use server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createInvoice, readInvoice, refreshInvoice, saveDraft, searchCustomers, sendInvoice } from "@/lib/quickbooks/invoices";
import type { InvoiceSnapshot } from "@/lib/quickbooks/model";

export async function invoiceAction(input: unknown) {
  const admin = await requireAdmin();
  try {
    const request = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), id: z.uuid(), revision: z.number().int().positive(), draft: z.unknown() }),
      z.object({ action: z.literal("create"), id: z.uuid(), revision: z.number().int().positive() }),
      z.object({ action: z.literal("send"), id: z.uuid(), reviewed: z.unknown() }),
      z.object({ action: z.literal("refresh"), id: z.uuid() }),
      z.object({ action: z.literal("reload"), id: z.uuid() }),
    ]).parse(input);
    let row;
    switch (request.action) {
      case "save": row = await saveDraft(request.id, request.revision, request.draft, admin.email); break;
      case "create": row = await createInvoice(request.id, request.revision, admin.email); break;
      case "send": row = await sendInvoice(request.id, request.reviewed as InvoiceSnapshot, admin.email); break;
      case "refresh": row = await refreshInvoice(request.id); break;
      case "reload": row = await readInvoice(request.id); break;
    }
    return { ok: true as const, row };
  } catch (e) {
    return { ok: false as const, error: e instanceof z.ZodError ? e.issues.map(i => i.message).join("; ") : (e as Error).message };
  }
}
export async function findInvoiceCustomers(search: string) {
  await requireAdmin();
  try { return { ok: true as const, customers: await searchCustomers(search) }; }
  catch (e) { return { ok: false as const, error: (e as Error).message }; }
}

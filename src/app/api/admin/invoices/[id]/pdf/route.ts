import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { readInvoice, verifyInvoiceCompany } from "@/lib/quickbooks/invoices";
import { qboPdf } from "@/lib/quickbooks/client";
import { idSchema } from "@/lib/quickbooks/model";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getCurrentAdmin()) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const row = await readInvoice((await params).id);
    await verifyInvoiceCompany(row);
    const id = idSchema.parse(row.qbo_invoice_id);
    const pdf = await qboPdf(`invoice/${id}/pdf`);
    return new NextResponse(pdf, { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="MIP-invoice-${id}.pdf"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new NextResponse("Could not load the invoice PDF. Refresh the invoice or reconnect QuickBooks.", { status: 400 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { applyZapierCallback } from "@/lib/quickbooks/invoices";
import { authorizedCallback, callbackSchema } from "@/lib/quickbooks/zapier";

/**
 * Final step of the "MIP reservation → QuickBooks invoice" Zap.
 * Auth: `Authorization: Bearer $ZAPIER_INVOICE_CALLBACK_SECRET`.
 * Body: JSON matching `callbackSchema` (request_id + QuickBooks invoice ID).
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!authorizedCallback(request.headers.get("authorization")))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ ok: false, error: z.prettifyError(parsed.error) }, { status: 400 });
  try {
    const result = await applyZapierCallback(parsed.data);
    if (!result.matched)
      return NextResponse.json({ ok: false, error: "unknown request_id" }, { status: 404 });
    return NextResponse.json({ ok: true, status: result.row.status, invoice_id: result.row.qbo_invoice_id });
  } catch (e) {
    console.error("[zapier] invoice callback failed", (e as Error).message);
    return NextResponse.json({ ok: false, error: "callback processing failed" }, { status: 500 });
  }
}

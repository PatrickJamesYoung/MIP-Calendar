import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { connection } from "@/lib/quickbooks/client";
import { loadReservationInvoice } from "@/lib/quickbooks/invoices";
import { kindSchema } from "@/lib/quickbooks/model";
import { InvoiceEditor } from "../../invoice-editor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export default async function InvoicePage({ params }: { params: Promise<{ kind: string; human_id: string }> }) {
  const admin = await requireAdmin();
  const { kind: rawKind, human_id } = await params;
  const kind = kindSchema.safeParse(rawKind);
  if (!kind.success) notFound();
  let data: Awaited<ReturnType<typeof loadReservationInvoice>> | null = null;
  let company = "";
  let enabled = false;
  let error = "";
  try {
    data = await loadReservationInvoice(kind.data, human_id, admin.email);
    const c = await connection();
    company = c ? `${c.company_name} (${c.environment})` : "Not connected";
    enabled = !!c?.enabled;
  } catch (e) { error = (e as Error).message; }
  return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <Link href={`/admin/${kind.data}/${encodeURIComponent(human_id)}`} className="text-sm underline">Back to reservation</Link>
    <div><h1 className="text-xl font-bold">Invoice for {human_id}</h1><p className="mt-1 text-sm text-neutral-600">QuickBooks company: {company}</p></div>
    {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-4">{error}</p>}
    {!enabled && <p className="rounded border border-amber-300 bg-amber-50 p-4">
      Invoicing is not enabled yet. A super admin must connect and confirm MIP in{" "}
      <Link className="underline" href="/admin/quickbooks">QuickBooks settings</Link>.
    </p>}
    {data && <InvoiceEditor initial={data.row} enabled={enabled} />}
  </div>;
}

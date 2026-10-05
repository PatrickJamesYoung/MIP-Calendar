"use client";
import { useState, useTransition } from "react";
import type { InvoiceRow } from "@/lib/quickbooks/invoices";
import type { InvoiceDraft } from "@/lib/quickbooks/model";
import { findInvoiceCustomers, invoiceAction } from "./actions";

const field = "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base disabled:bg-neutral-100";
const button = "min-h-11 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-50";
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

export function InvoiceEditor({ initial, enabled }: { initial: InvoiceRow; enabled: boolean }) {
  const [row, setRow] = useState(initial);
  const [draft, setDraft] = useState<InvoiceDraft>(initial.draft);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const editable = row.status === "draft";
  const dirty = JSON.stringify(draft) !== JSON.stringify(row.draft);
  const update = (patch: Partial<InvoiceDraft>) => {
    setDraft(d => ({ ...d, ...patch })); setConfirmCreate(false);
  };
  function act(action: "save" | "create" | "send" | "refresh" | "reload") {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await invoiceAction({
        action, id: row.id, revision: row.revision, draft, reviewed: row.snapshot,
      });
      setConfirmSend(false); setConfirmCreate(false);
      if (!result.ok) { setError(result.error); return; }
      setRow(result.row); setDraft(result.row.draft);
      setNotice(action === "save" ? "Local draft saved. Nothing has been created or sent in QuickBooks."
        : action === "create" ? result.row.status === "sent"
          ? "QuickBooks reports this invoice already sent. Check the warning below before invoicing again."
          : "Invoice created in QuickBooks, not sent. Review the final invoice, including any tax, before sending."
        : action === "send" ? "QuickBooks confirmed the invoice was sent. This does not confirm inbox delivery."
        : "Invoice state refreshed.");
    });
  }
  const final = row.snapshot;
  return <div className="space-y-6">
    <p className="text-sm text-neutral-600">Local draft → Create in QuickBooks → Review final invoice → Send. No invoice is created or emailed automatically.</p>
    {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-4">{error}</p>}
    {notice && <p role="status" className="rounded border border-green-300 bg-green-50 p-4">{notice}</p>}
    {row.last_error && <p className="rounded border border-amber-300 bg-amber-50 p-4">Last operation: {row.last_error}</p>}
    <section className="space-y-4 rounded-lg border bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{editable ? "Invoice draft" : "Submitted invoice details"}</h2>
        <span className="rounded border px-3 py-1 text-sm">Status: {row.status === "created" ? "Created, not sent" : row.status}</span>
      </div>
      {editable && <div className="space-y-3 border-b pb-5">
        <label className="block">Find an existing QuickBooks customer
          <input className={field} value={query} onChange={e => setQuery(e.target.value)} placeholder="Organization or customer name" />
        </label>
        <button className={button} disabled={pending || !enabled || query.trim().length < 2}
          onClick={() => startTransition(async () => {
            setError("");
            const result = await findInvoiceCustomers(query);
            if (!result.ok) setError(result.error);
            else {
              setCustomers(result.customers);
              if (!result.customers.length) setNotice("No matching customers found. You can create a new customer with this invoice.");
            }
          })}>Search customers</button>
        {customers.length > 0 && <ul className="space-y-2">{customers.map(c => <li key={c.id}>
          <button className={`${button} w-full text-left`} onClick={() => {
            update({ customerId: c.id, customerName: c.name.slice(0, 100), email: c.email || draft.email });
            setCustomers([]);
          }}>{c.name}{c.email ? ` · ${c.email}` : ""}</button>
        </li>)}</ul>}
        <p className="text-sm">{draft.customerId ? `Existing customer selected (ID ${draft.customerId}).` : "A new customer will be created when you create this invoice. Search first to avoid duplicate customer records."}</p>
        {draft.customerId && <button className={button} onClick={() => update({ customerId: "" })}>Use a new customer instead</button>}
      </div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Billing customer / organization
          <input className={field} value={draft.customerName} maxLength={100}
            disabled={!editable || !!draft.customerId || pending} onChange={e => update({ customerName: e.target.value })} />
        </label>
        <label>Recipient email
          <input className={field} type="email" value={draft.email} disabled={!editable || pending} onChange={e => update({ email: e.target.value })} />
        </label>
        <label>Invoice date (Eastern time)
          <input className={field} type="date" value={draft.invoiceDate} disabled={!editable || pending}
            onChange={e => update({ invoiceDate: e.target.value })} />
        </label>
        <label>Due date (defaults to Net 15)
          <input className={field} type="date" value={draft.dueDate} disabled={!editable || pending}
            onChange={e => update({ dueDate: e.target.value })} />
        </label>
      </div>
      <p className="text-sm text-neutral-600">Line amounts already include the reservation’s sliding-scale adjustment. Editing this invoice does not change the reservation; later reservation edits do not change this draft.</p>
      <div className="space-y-3">
        {draft.lines.map((line, index) => <fieldset key={index} className="grid gap-3 rounded border p-3 sm:grid-cols-[1fr_100px_150px_auto]">
          <legend className="px-1 text-sm font-medium">Line {index + 1}</legend>
          <label>Description<input className={field} value={line.description} disabled={!editable || pending} maxLength={500}
            onChange={e => update({ lines: draft.lines.map((l, i) => i === index ? { ...l, description: e.target.value } : l) })} /></label>
          <label>Quantity<input className={field} type="number" min="0.0001" step="any" value={line.quantity} disabled={!editable || pending}
            onChange={e => update({ lines: draft.lines.map((l, i) => i === index ? { ...l, quantity: Number(e.target.value) } : l) })} /></label>
          <label>Line total (USD)<input className={field} type="number" min="0" step="0.01" value={line.amount} disabled={!editable || pending}
            onChange={e => update({ lines: draft.lines.map((l, i) => i === index ? { ...l, amount: Number(e.target.value) } : l) })} /></label>
          {editable && <button aria-label={`Remove line ${index + 1}`} className={`${button} self-end`} disabled={pending || draft.lines.length === 1}
            onClick={() => update({ lines: draft.lines.filter((_, i) => i !== index) })}>Remove</button>}
        </fieldset>)}
      </div>
      {editable && <button className={button} disabled={pending || draft.lines.length >= 100}
        onClick={() => update({ lines: [...draft.lines, { description: "", quantity: 1, amount: 0 }] })}>Add line</button>}
      <p className="text-sm">Quantity is descriptive; changing it does not multiply the line total. Edit the line total to change the amount billed.</p>
      <p className="text-right font-semibold">Subtotal before QuickBooks tax: {money(draft.lines.reduce((sum, l) => sum + l.amount, 0))}</p>
      <label className="block">Customer message
        <textarea className={field} rows={3} maxLength={1000} value={draft.memo} disabled={!editable || pending}
          onChange={e => update({ memo: e.target.value })} />
      </label>
      {editable && <div className="space-y-4 border-t pt-4">
        <button className={button} disabled={pending} onClick={() => act("save")}>Save local draft</button>
        <label className="flex items-start gap-3"><input className="mt-1 h-5 w-5" type="checkbox" checked={confirmCreate}
          disabled={dirty || pending || !enabled} onChange={e => setConfirmCreate(e.target.checked)} />
          <span>I reviewed these saved charges and customer details. Create a real invoice in the connected QuickBooks company, without sending it yet.</span>
        </label>
        {dirty && <p className="text-sm">Save your changes before creating the invoice.</p>}
        <button className={`${button} bg-neutral-900 text-white`} disabled={pending || dirty || !confirmCreate || !enabled}
          onClick={() => act("create")}>Create invoice in QuickBooks</button>
      </div>}
      {row.status === "creating" && <div className="space-y-3 border-t pt-4">
        <p>The creation result is unresolved. This draft is locked to protect against duplicates. Retry uses the same saved request, not a new invoice.</p>
        <button className={button} disabled={pending || !enabled} onClick={() => act("create")}>Recover creation result</button>
      </div>}
    </section>
    {final && <section className="space-y-4 rounded-lg border bg-white p-4 sm:p-6">
      <h2 className="text-lg font-semibold">QuickBooks invoice #{final.number}</h2>
      <p>Customer: {final.customerName}<br />To: <strong>{final.email}</strong><br />
        {final.cc && <>CC: {final.cc}<br /></>}{final.bcc && <>BCC: {final.bcc}<br /></>}
        Invoice date: {final.invoiceDate}<br />Due: {final.dueDate}<br />
        Total including tax: <strong>{money(final.total)}</strong><br />
        Outstanding balance: {money(final.balance)}<br />
        Payment status: {final.balance === 0 ? "Paid / no balance" : final.balance < final.total ? "Partially paid" : "Unpaid"}</p>
      <ul className="space-y-1 text-sm">{final.lines.map((l, i) => <li key={i} className="flex justify-between gap-4"><span>{l.description}</span><span>{money(l.amount)}</span></li>)}</ul>
      <p className="whitespace-pre-wrap text-sm">{final.memo}</p>
      <p className="text-sm">QuickBooks email status: {final.emailStatus}. Refresh to check for changes or payments.</p>
      <div className="flex flex-wrap gap-3">
        <a className={button} href={`/api/admin/invoices/${row.id}/pdf`} target="_blank" rel="noopener noreferrer">Preview invoice PDF</a>
        <button className={button} disabled={pending || !enabled} onClick={() => act("refresh")}>Refresh from QuickBooks</button>
      </div>
      {row.status !== "sent" && final.balance > 0 && <div className="space-y-4 border-t pt-4">
        <label className="flex items-start gap-3"><input className="mt-1 h-5 w-5" type="checkbox" checked={confirmSend}
          onChange={e => setConfirmSend(e.target.checked)} disabled={pending || !enabled} />
          <span>I reviewed the final invoice/PDF and authorize QuickBooks to email invoice #{final.number} for {money(final.total)} to {final.email}{final.cc ? `; CC: ${final.cc}` : ""}{final.bcc ? `; BCC: ${final.bcc}` : ""}.</span>
        </label>
        <button className={`${button} bg-neutral-900 text-white`} disabled={pending || !confirmSend || !enabled}
          onClick={() => act("send")}>{row.status === "sending" ? "Check and recover send" : "Send invoice through QuickBooks"}</button>
      </div>}
    </section>}
    <button className={button} disabled={pending} onClick={() => act("reload")}>Reload saved invoice state</button>
    {pending && <p role="status" className="text-sm">Working. Please keep this page open.</p>}
  </div>;
}

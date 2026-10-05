import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { configuration, connection, qbo } from "@/lib/quickbooks/client";
import { connectQuickBooks, disconnectQuickBooks, saveQuickBooksSettings, type ItemOption } from "./actions";
import { QuickBooksDisconnectForm } from "@/components/quickbooks-disconnect-form";

export const dynamic = "force-dynamic";
export default async function QuickBooksSettings({ searchParams }: {
  searchParams: Promise<{ error?: string; saved?: string; connected?: string; disconnected?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  let c: Awaited<ReturnType<typeof connection>> = null;
  let setupError = "";
  let items: ItemOption[] = [];
  try {
    configuration();
    c = await connection();
    if (c?.tokens_encrypted) {
      const result = await qbo<{ QueryResponse: { Item?: ItemOption[] } }>(
        `query?query=${encodeURIComponent("select * from Item where Active = true maxresults 1000")}`);
      items = (result.QueryResponse.Item || []).filter(i => ["Service", "NonInventory"].includes(i.Type));
    }
  } catch (e) { setupError = (e as Error).message; }
  const input = "w-full rounded-md border border-neutral-300 bg-white p-2 text-sm";
  return <div className="mx-auto max-w-3xl space-y-6 p-6">
    <h1 className="text-xl font-bold">QuickBooks invoicing</h1>
    <p>Connect the MIP company once. Portal admins can then review and send Gear and Spaces invoices without their own QuickBooks login.</p>
    {(params.error || setupError) && <p role="alert" className="rounded border border-red-300 bg-red-50 p-4">{params.error || setupError}</p>}
    {params.saved && <p role="status" className="rounded border border-green-300 bg-green-50 p-4">MIP invoicing settings saved.</p>}
    {params.disconnected && !c?.tokens_encrypted && <p role="status" className="rounded border border-green-300 bg-green-50 p-4">QuickBooks disconnected. Existing invoices and accounting records have not been deleted.</p>}
    <section className="space-y-3 rounded-lg border p-5">
      <h2 className="text-lg font-semibold">Company connection</h2>
      {c ? <p><strong>{c.company_name}</strong><br />Company ID: {c.realm_id}<br />
        Environment: {c.environment}<br />{!c.tokens_encrypted ? "Disconnected" : c.enabled ? "Enabled" : "Invoicing disabled; review setup or reconnect"}</p>
        : <p>No company connected. Select the MIP company, not Re:Action, when authorizing.</p>}
      <form action={connectQuickBooks}><button className="rounded bg-neutral-900 px-4 py-2 text-white"
        disabled={!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET || !process.env.QBO_TOKEN_ENCRYPTION_KEY}>
        {c ? "Reconnect QuickBooks" : "Connect to QuickBooks"}</button></form>
      <p className="text-sm text-neutral-600">Only super admins can connect or configure accounting. Tokens are encrypted server-side and refreshed automatically while authorization remains valid.</p>
      {c?.tokens_encrypted && <QuickBooksDisconnectForm company={c.company_name} realm={c.realm_id} action={disconnectQuickBooks} />}
    </section>
    {c?.tokens_encrypted && <form action={saveQuickBooksSettings} className="space-y-5 rounded-lg border p-5">
      <h2 className="text-lg font-semibold">Invoice accounting defaults</h2>
      <p className="text-sm">Select existing QuickBooks items to route each reservation line to the correct income account. Descriptions, quantities and amounts remain itemized. Ask your bookkeeper which items and tax treatment to use; the portal does not infer tax exemption.</p>
      <input type="hidden" name="realm" value={c.realm_id} />
      {(["gear", "spaces"] as const).map(kind => <fieldset key={kind} className="space-y-2">
        <legend className="font-medium capitalize">{kind}</legend>
        <label className="block">QuickBooks product/service
          <select required name={`${kind}Item`} defaultValue={c![`${kind}_item_id`] || ""} className={input}>
            <option value="">Choose an accounting item</option>
            {items.map(i => <option key={i.Id} value={i.Id}>{i.Name}</option>)}
          </select>
        </label>
        <label className="block">Sales-tax treatment
          <select required name={`${kind}Tax`} defaultValue={c![`${kind}_tax_code`] || ""} className={input}>
            <option value="">Choose explicitly</option>
            <option value="NON">Non-taxable</option><option value="TAX">Taxable (QuickBooks calculates)</option>
          </select>
        </label>
      </fieldset>)}
      <label className="flex gap-3"><input required type="checkbox" name="confirm" className="h-5 w-5" />
        I confirm {c.company_name} (ID {c.realm_id}) is the MIP company and these accounting defaults are correct.</label>
      <label className="flex gap-3"><input required type="checkbox" name="autoSendOff" className="h-5 w-5" />
        I verified automatic sending of imported invoices is OFF in QuickBooks (Account and Settings → Sales → Invoice payments), so creating an invoice will not email it before review.</label>
      <p className="text-sm">This is a one-time company setup check. QuickBooks can enable automatic sending independently of the API. If that happens, the portal detects it and disables further invoicing until this setting is checked again.</p>
      <p className="text-sm">Default terms: Net 15. Invoices are never sent automatically when a reservation is submitted or approved.</p>
      <button className="rounded bg-neutral-900 px-4 py-2 text-white" disabled={!items.length}>Confirm MIP company and save</button>
    </form>}
    <p className="text-sm text-neutral-600">Review the <Link className="underline" href="/reservations/privacy">Reservations Privacy Policy</Link> and <Link className="underline" href="/reservations/terms">Terms of Use</Link>. Connecting authorizes MIP reservation accounting only; this portal does not request QuickBooks Payments access.</p>
    <Link href="/admin/gear" className="underline">Back to reservations</Link>
  </div>;
}

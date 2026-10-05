export function QuickBooksDisconnectForm({ company, realm, action }: {
  company: string; realm: string; action: (formData: FormData) => Promise<void>;
}) {
  return <form action={action} className="space-y-3 border-t pt-4">
    <input type="hidden" name="realm" value={realm} />
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name="confirmDisconnect" required className="mt-1 h-4 w-4 shrink-0" />
      <span>Disconnect {company} from this portal and revoke its Intuit authorization. Existing invoices, customer records, and reservation history will remain. An already-running operation may finish before disconnection.</span>
    </label>
    <button className="rounded border border-red-400 px-4 py-2 text-red-800">Disconnect QuickBooks</button>
  </form>;
}

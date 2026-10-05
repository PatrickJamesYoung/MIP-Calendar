# MIP reservation invoicing

Both Gear and Spaces use the same portal workflow: save a local draft, create an invoice in MIP QuickBooks Online, review the provider's final invoice/PDF, then explicitly send it. Itemized line amounts preserve the saved sliding-scale total exactly; the initial invoice date is Eastern time and the due date defaults to Net 15.

## Deployment and one-time setup

1. Review and merge the feature PR through the normal main-branch process.
2. Migration `supabase/migrations/0111_quickbooks_invoices.sql` was applied to production with approval on October 5, 2026. This adds integration, local invoice, OAuth-state, lock and activity tables. All were verified RLS-enabled with no anonymous/authenticated-role read access; only the backend service role can access them.
3. Create a dedicated Intuit Developer app for MIP's QuickBooks Online company and obtain production Accounting API credentials. Do not reuse the Re:Action connection in Perplexity. Intuit requires app registration and administrator consent even for an app used only by its own company ([Intuit OAuth guide](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)).
4. Register this exact redirect URI in the Intuit app:
   `https://app.movementinfrastructureproject.org/api/quickbooks/callback`
5. Add these Vercel Production environment variables securely, then redeploy:
   - `QBO_CLIENT_ID`: the production Intuit app client ID.
   - `QBO_CLIENT_SECRET`: its client secret.
   - `QBO_REDIRECT_URI`: the exact HTTPS callback URI above.
   - `QBO_ENVIRONMENT`: `production`.
   - `QBO_TOKEN_ENCRYPTION_KEY`: base64-encoded, cryptographically random 32-byte key, generated with `openssl rand -base64 32`. Treat this as a secret and retain it; changing it makes existing encrypted tokens unreadable.
6. As a portal super admin, open **Admin → QuickBooks → Connect to QuickBooks** and authorize the MIP company. The OAuth callback displays the company name and company ID; the first connection remains disabled until confirmed.
7. In QuickBooks company settings, verify automatic sending of imported invoices is OFF. Some companies have a feature that auto-emails newly created invoices regardless of API payload; Intuit's guidance points to Account and Settings → Sales → Invoice payments ([Intuit guidance](https://help.developer.intuit.com/s/question/0D5TR00001Nq74f0AB/how-do-we-prevent-qbo-from-autoemailing-invoices-created-via-the-api)).
8. Back in the portal, choose existing QuickBooks Service/NonInventory items for Gear and Spaces and explicitly choose each module's sales-tax treatment. Ask MIP's bookkeeper which accounting items and tax codes are appropriate; the integration does not create income accounts or assume donation tax treatment.
9. Confirm this is the MIP company and automatic import-emailing is disabled, then enable invoicing. These setup actions require a super admin; ordinary portal admins can invoice afterwards.

For sandbox testing, use sandbox Intuit credentials, `QBO_ENVIRONMENT=sandbox`, a separate HTTPS callback and a separate Supabase database. Never point a preview/sandbox deployment at the production integration tables. This implementation refuses an environment mismatch or reconnecting a different company over an existing company connection.

## Operator workflow

- Open a Gear or Spaces reservation, then **Open invoice**.
- Search and select an existing customer, or explicitly accept creating a new customer with the invoice. The default new-customer name gets a reservation-specific suffix to avoid name collisions; searching first avoids duplicate customer records across reservations.
- Review the recipient email, itemized descriptions, quantities, adjusted line totals, invoice date, due date and customer message. Saving the draft writes only to the portal database.
- Check the creation approval box and select **Create invoice in QuickBooks**. This creates a real accounting transaction, not a QuickBooks draft. It is a separate action from sending.
- Review the actual QuickBooks total including tax, any CC/BCC recipients, customer message and PDF. Check the send approval box and send through QuickBooks.
- Use **Refresh from QuickBooks** to check its current balance and email status. Sent means the provider reports `EmailSent`, not proof of inbox delivery.

QuickBooks requires customer and product/service references on invoices; actual invoice creation and sending use its Accounting API ([invoice workflow](https://developer.intuit.com/app/developer/qbo/docs/workflows/create-an-invoice)). Subsequent API operations use stored encrypted tokens and automatic refresh, so ordinary portal invoicing does not require a separate QuickBooks login; expired/revoked authorization requires reconnecting ([OAuth FAQ](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq)).

## Safety and limits

- One linked invoice per reservation in this initial version. No automatic invoicing on submission, approval or return.
- USD and US QuickBooks Online only. Service/NonInventory item mapping only; no inventory depletion from invoicing.
- Editing is supported before creating the QuickBooks transaction. Voids, credits, post-creation invoice edits, multiple installments and manual resend are outside this initial version.
- Invoice drafts are independent snapshots: reservation edits do not silently change an invoice, and invoice edits do not change reservations.
- Invoice creation uses a persisted request ID and frozen payload. Database locks protect against concurrent clicks; retrying after a lost response uses the same request ID, consistent with [Intuit's idempotency guidance](https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions).
- Received validation/auth rejections return the local record to draft. Timeouts, unknown results and failure to store a successfully created invoice keep the frozen request for recovery; do not create a replacement.
- Recovery retries stop after 23 hours. Unresolved operations then need deliberate reconciliation rather than risking duplicate accounting entries.
- Sending checks the latest provider snapshot against the reviewed snapshot. Changes to amount, recipient, CC/BCC, balance, dates, memo, line descriptions or version require another review.
- If QuickBooks auto-emails on creation, the returned status is recorded as sent and the connection is disabled pending another setup check. The portal does not promise it can override a company-side auto-email feature.
- PDF downloads require a portal admin session and enforce the linked company/environment.
- Refresh is on demand. No payment webhook or new recurring task is installed.
- Online-payment availability depends on the MIP QuickBooks company and its existing payment configuration; the portal does not collect card/bank details or enable QuickBooks Payments.
- OAuth tokens are AES-256-GCM encrypted before database storage. Secrets are never sent to browser components or written into logs. OAuth state is one-use, expires after ten minutes and is bound to both the initiating super admin and an HttpOnly Secure browser cookie.
- Super admins can explicitly disconnect from `/admin/quickbooks`. This disables invoicing, calls Intuit's token revocation API, then removes local encrypted tokens only after a successful response. Company identity and invoice records remain, so reconnecting cannot silently switch to another company. A failed or ambiguous revoke stays disabled and retryable. Requests, refresh, callbacks and revocation share a connection lock.

## Policy pages and production-registration URLs

Policy wording was approved October 5, 2026, with one implementation disclosure added for the existing Cloudflare anti-spam integration. Confirm the effective date before deploying if publication is delayed. These URLs become live only after the PR is merged and deployed:

- Privacy: `https://app.movementinfrastructureproject.org/reservations/privacy`
- Terms/EULA: `https://app.movementinfrastructureproject.org/reservations/terms`
- Host domain: `app.movementinfrastructureproject.org`
- Launch, connect/reconnect and disconnect landing page: `https://app.movementinfrastructureproject.org/admin/quickbooks`
- OAuth redirect: `https://app.movementinfrastructureproject.org/api/quickbooks/callback`

The authenticated settings page provides the disconnect confirmation control; merely visiting the URL never revokes access. The policies have links in the footer, reservation forms and integration settings. Gear and Spaces require versioned policy acknowledgement, validate it server-side and log it in existing activity tables before external notifications. No additional database migration is needed.

Analytics are limited to an explicit allowlist of public landing/policy pages, with query strings and fragments removed. Admin, invoice, OAuth, reservation forms, confirmation and unknown routes are denied. The current location is checked at send time as well as the event URL for SPA transitions. Referrer metadata is set to `no-referrer`.

Before production launch, verify the shared space-calendar audience: the pre-existing sync includes requester name and email in event descriptions. The policy discloses this; this PR does not change historical events or calendar-sharing permissions. Confirm organizational retention, provider access and request-handling practices rather than treating policy text as a completed compliance audit.

## QA inventory and results

- Pure tests: exact-cent allocation, free items, ET dates, Net 15 over DST/year boundaries, invalid dates/email/amounts, quantity precision and JSONB-independent review comparison.
- Mocked service tests: create once, lost-response retry, failed database linkage, concurrent/stale operations, company mismatch, missing setup confirmation, submitted-draft lock, external invoice changes, no implicit resend, already-sent recovery, payment refresh and unexpected auto-send detection.
- Isolated browser harness uses the actual React editor with mocked actions only: customer selection, add/remove line, invalid-email feedback, local save, create confirmation, final review, send confirmation and sent state; desktop and 375px mobile layout checks.
- Production build uses `next build --webpack`. No live customers, invoices, emails or company settings were changed by these tests.
- Additional mocked/pure tests cover disconnect ordering, failed/ambiguous revocation, wrong-company/concurrent operations, repeated disconnect, requests after disconnection, analytics filtering, and rejection of missing/stale policy acknowledgement.
- October 5 follow-up verification: 112 tests passed across 14 files; TypeScript, production build and focused ESLint passed. Both policy pages were inspected at 1365px and 375px, including policy navigation, mobile menu and footer, with no page errors or horizontal overflow. Isolated browser tests of the actual consent and disconnect components blocked unconfirmed submits and accepted explicitly checked submits using mocked actions only. Live Intuit revocation remains untested.
- Still required: policy publication, Intuit production approval, live MIP authorization, actual accounting item/tax mapping, provider validation of OAuth/refresh/create/PDF/send/disconnect, and an explicitly approved production smoke test.

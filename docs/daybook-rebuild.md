# DC Daybook rebuild — architecture and operations

Status: **scaffold**. Live sends disabled until `composeWithLlm` is wired and
manual approval gate has run for at least 5 clean weekdays.

## Why this exists

The Perplexity-era Daybook and Weekly Planner were paused after four
compounding failure modes:

1. Background network failures inside the Perplexity task runtime.
2. A race that published an inferior fallback while a good draft was
   still composing.
3. Weak validation — bad drafts could reach subscribers.
4. Archive correction landing after the send had already gone out.

This rebuild eliminates each one by moving off Perplexity and onto the same
GitHub Actions + Next.js API + Supabase runtime we already trust for the DC
events ingest.

## Runtime

- **Scheduler**: GitHub Actions cron (`.github/workflows/daybook.yml`).
  Weekdays 06:15 ET (`15 10 * * 1-5`), Sundays 07:00 ET (`0 11 * * 0`).
  Cron is UTC on GitHub Actions and does not follow DST. The 1-hour
  EDT↔EST drift is accepted, matching the existing `ingest.yml` decision.
- **Fetchers**: Python 3.11, `ingest/daybook/fetch_daybook_sources.py`.
  Each source is isolated; failure in one does not abort the run.
- **Composition, validation, send**: Next.js API routes at
  `/api/daybook/{run,sources,compose,send,alert}`, all bearer-gated by
  `DAYBOOK_BEARER_TOKEN`.
- **State**: Supabase, `0300_daybook_schema.sql`. Five tables:
  `daybook_runs`, `daybook_sources`, `daybook_drafts`, `daybook_sends`,
  `daybook_mirrors`.
- **Delivery**: Buttondown, single canonical send. No Gmail fallback.
- **Notion mirror**: post-send only, via Notion API. Weather stripped.
- **Alerting**: Resend email to `ADMIN_NOTIFY_EMAILS`; workflow also
  fires `/api/daybook/alert` on failure.

## How duplicate sends are prevented

Three layers, all required:

1. `/api/daybook/run` refuses to start a new run when a `sent` or
   `mirrored` run already exists for `(publication_date, edition)`.
2. `/api/daybook/send` INSERTs into `daybook_sends` **before** calling
   Buttondown; the UNIQUE constraint on `(publication_date, edition)`
   turns any concurrent send attempt into a `23505` error.
3. GitHub Actions `concurrency:` group prevents overlapping runs of the
   same edition.

The Perplexity race that published a fallback while a better draft was
still composing is impossible here because composition and send are two
separate synchronous API calls, and only `status='rendered'` runs can
be sent.

## Pre-send validation

See `src/lib/daybook/validation.ts`. Every check is deterministic. Any
failure sets `daybook_runs.status='blocked'`, fires an alert, and prevents
`/send` from proceeding.

Current checks:

- Subject present and contains the publication date.
- No template placeholders in rendered HTML (`{{...}}`, `TODO`,
  `undefined`, `[object Object]`, `NaN`, bare `null`).
- Movement calendar item count matches the source ICS count.
- Buttondown publication home resolves (HEAD check).
- HTML byte size between 2 KB and 500 KB.
- No section header with an empty body.

Add checks liberally; false positives (blocked sends) are cheap, false
negatives (bad drafts sent) are the failure mode we are engineering out.

## User-preference honoring

- Weather is omitted from the Notion mirror (`renderForNotion`).
- Empty, non-substantive, and failed sections are dropped from the
  rendered output rather than shown with "N/A".
- All routine outputs land in Notion; failures land in email (matches
  Patrick's routing preference).

## Environment

| Env var | Where | Purpose |
|---|---|---|
| `DAYBOOK_API_BASE` | Actions secret | e.g. `https://mip-calendar.vercel.app` |
| `DAYBOOK_BEARER_TOKEN` | Actions secret + Vercel env | Shared secret for `/api/daybook/*` |
| `BUTTONDOWN_API_KEY` | Vercel env | Publication delivery |
| `RESEND_API_KEY` | Vercel env | Failure alerts |
| `EMAIL_FROM` | Vercel env | From address on alerts |
| `ADMIN_NOTIFY_EMAILS` | Vercel env | Comma-separated recipients |
| `CONGRESS_API_KEY` | Actions secret | api.congress.gov |
| `ANTHROPIC_API_KEY` | Vercel env | Claude Sonnet 4.5 composition |
| `OPENAI_API_KEY` | Vercel env | GPT-5 fallback |

## Rollout plan

1. Apply migration `0300_daybook_schema.sql`.
2. Provision all env vars above.
3. Merge this branch; verify the workflow appears with `workflow_dispatch`.
4. Run manually with `dry_run=true` for 5 weekdays. Inspect
   `daybook_drafts.validation_report` — every check should pass.
5. Wire `composeWithLlm` in `/api/daybook/compose/route.ts` (Vercel AI SDK
   + Zod schema tool, prompt from `src/lib/daybook/prompts/compose.md`).
6. Re-run dry for another 5 weekdays with real composition output.
7. Enable live sends by removing `dry_run: true` from the schedule
   invocation. Keep the manual-dispatch flag.
8. Add the Notion mirror step (`/api/daybook/mirror`, not yet built).

## What is NOT yet built

- `/api/daybook/mirror` for the Notion post-send step.
- FactBase, AlertDC parsers (fetchers exist and capture raw HTML into
  `daybook_sources.payload` during dry runs so we can design the parser
  from real data before enabling).
- DC Council hearings parser (stub returns ok=true with empty items so
  compose drops the section cleanly).
- Wiki-note update once shipped (updates `memory/knowledge/projects/dc-daybook.md`).

## Composed

- `composeWithLlm` in `src/lib/daybook/compose.ts` — Vercel AI SDK,
  Claude Sonnet 4.5 primary, GPT-5 fallback, structured via Zod schema.
  Fallback only fires on primary error, not on schema violation.
- `_parse_ics` — full VEVENT + RRULE expansion via `icalendar` +
  `python-dateutil`, tested with fixture ICS covering single events,
  out-of-window events, and weekly recurrence.
- Forth pool parser — tries `__NEXT_DATA__` first, falls back to a
  time-prefixed text scan; returns ok=false if neither yields items.
- Congress.gov v3 committee-meeting fetcher — list-then-detail with
  capped fanout, normalized to `CommitteeHearing[]`.
- SCOTUS, Mayor's Office — non-blocking ok=true empty stubs so compose
  drops the sections rather than fails (matches the wiki: SCOTUS reuses
  Weekly Planner archive; Mayor's Office lacks a public JSON feed).

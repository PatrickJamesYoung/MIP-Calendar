-- Daybook rebuild — durable state for the DC Daybook and DC Weekly Planner
-- publications. One row per scheduled run; raw source payloads and rendered
-- drafts recorded for replay and audit; send records enforced UNIQUE to make
-- duplicate sends impossible at the database level.
--
-- Design decisions (see docs/daybook-rebuild.md for full context):
--   - No RLS: these tables are written only by the service-role client from
--     the /api/daybook/* routes, which are already bearer-gated. Never expose
--     to browser clients.
--   - `edition` distinguishes 'daybook' (weekday briefing) from 'weekly'
--     (Sunday Weekly Planner). Both share the same pipeline shape.
--   - `daybook_sends (publication_date, edition)` UNIQUE is the last-line
--     defense against the "publish inferior fallback" race that killed the
--     Perplexity version.

create type daybook_edition as enum ('daybook', 'weekly');

create type daybook_run_status as enum (
  'started',        -- run created, sources not yet fetched
  'fetched',        -- all fetchers completed (some may have failed non-fatally)
  'composed',       -- LLM composition done, JSON validated
  'rendered',       -- HTML rendered, pre-send validation passed
  'blocked',        -- validation gate rejected — no send, alert fired
  'sent',           -- Buttondown 200 OK
  'mirrored',       -- Notion mirror complete (terminal success)
  'failed'          -- fatal error at any step (alert fired)
);

-- One row per scheduled run.
create table daybook_runs (
  id uuid primary key default gen_random_uuid(),
  publication_date date not null,
  edition daybook_edition not null,
  status daybook_run_status not null default 'started',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  github_run_id text,
  github_run_url text,
  -- Idempotency: only one non-failed run per (date, edition). Retries after
  -- a failed run are allowed; a successful run blocks all future starts.
  constraint daybook_runs_one_success
    unique (publication_date, edition, status)
    deferrable initially deferred
);
create index daybook_runs_date_edition_idx
  on daybook_runs (publication_date desc, edition);

-- Raw source payloads keyed by run. Enables replay and post-mortem.
create table daybook_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references daybook_runs(id) on delete cascade,
  source_key text not null,     -- 'mip_calendar', 'forth', 'factbase', 'congress', ...
  fetched_at timestamptz not null default now(),
  ok boolean not null,
  http_status int,
  bytes int,
  payload jsonb,                -- normalized JSON or {"raw": "..."} for HTML/ICS
  error text,
  unique (run_id, source_key)
);
create index daybook_sources_run_idx on daybook_sources (run_id);

-- Composed draft (LLM JSON output + rendered HTML + validation report).
create table daybook_drafts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references daybook_runs(id) on delete cascade unique,
  composed_json jsonb not null,
  rendered_html text not null,
  subject text not null,
  validation_report jsonb not null,   -- { checks: [{name, ok, detail}], passed: bool }
  llm_model text,
  llm_tokens_in int,
  llm_tokens_out int,
  created_at timestamptz not null default now()
);

-- Send record. UNIQUE constraint on (publication_date, edition) is the
-- hard guarantee that no duplicate publication is ever sent. If the API
-- route sees this insert fail, it aborts and alerts.
create table daybook_sends (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references daybook_runs(id) on delete cascade,
  publication_date date not null,
  edition daybook_edition not null,
  buttondown_email_id text,
  archive_url text,
  sent_at timestamptz not null default now(),
  unique (publication_date, edition)
);
create index daybook_sends_date_idx on daybook_sends (publication_date desc);

-- Notion mirror record. Separate from sends so a Notion failure doesn't
-- block the send from being marked successful.
create table daybook_mirrors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references daybook_runs(id) on delete cascade unique,
  notion_page_id text,
  mirrored_at timestamptz not null default now(),
  ok boolean not null,
  error text
);

comment on table daybook_runs is 'One row per Daybook/Weekly Planner scheduled run. See docs/daybook-rebuild.md.';
comment on table daybook_sends is 'Send ledger. (publication_date, edition) UNIQUE prevents duplicate sends.';

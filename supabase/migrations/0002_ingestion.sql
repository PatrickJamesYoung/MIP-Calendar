-- ============================================================
-- Migration 0002: Ingestion pipeline
--
-- Adds source tracking to submissions + two supporting tables so the
-- bi-weekly DC events ingestor (GitHub Actions runs runner.py) can post
-- into the submissions queue idempotently, and we have observable runs.
-- ============================================================

-- ---- 1. submissions: source tracking columns --------------------------------

alter table submissions
  add column if not exists source_type text not null default 'public',
  add column if not exists source_name text,
  add column if not exists source_external_id text,
  add column if not exists source_url text,
  add column if not exists auto_submit boolean not null default false;

-- source_type valid values: 'public' | 'ingest'
-- We store the constraint as a CHECK so the app can add new types later
-- without an enum migration.
alter table submissions
  drop constraint if exists submissions_source_type_check;
alter table submissions
  add constraint submissions_source_type_check
    check (source_type in ('public', 'ingest'));

-- Idempotency for ingested events. A given (source_name, source_external_id)
-- can appear at most once. NULLs (public submissions) are ignored by unique.
create unique index if not exists submissions_source_unique_idx
  on submissions (source_name, source_external_id)
  where source_type = 'ingest' and source_external_id is not null;

create index if not exists submissions_source_type_idx
  on submissions (source_type);
create index if not exists submissions_source_name_idx
  on submissions (source_name);

-- ---- 2. ingestion_runs: one row per scheduled run ---------------------------

create table if not exists ingestion_runs (
  id uuid primary key default uuid_generate_v4(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',        -- running | success | failed
  fetched_count integer not null default 0,      -- total events pulled from sources
  new_count integer not null default 0,          -- after dedup, before classification
  submitted_count integer not null default 0,    -- rows actually inserted into submissions
  skipped_count integer not null default 0,      -- 'Don't Submit' or dedup hits
  auto_submit_count integer not null default 0,  -- of submitted_count, how many were curated
  by_source jsonb,                               -- {"Free DC": {"fetched": 12, "new": 5, "submitted": 5}, ...}
  error_message text,
  triggered_by text,                             -- 'github-actions' | 'manual'
  runner_version text
);

alter table ingestion_runs
  drop constraint if exists ingestion_runs_status_check;
alter table ingestion_runs
  add constraint ingestion_runs_status_check
    check (status in ('running', 'success', 'failed'));

create index if not exists ingestion_runs_started_at_idx
  on ingestion_runs (started_at desc);

-- ---- 3. ingestion_history: historical dedup baseline ------------------------
--
-- Populated once from events_history.jsonl (873 events from May-July 2026
-- collected by the old runner.py + Google Sheets pipeline). Serves purely
-- as a dedup set for future ingestion runs so we don't re-submit events
-- the human already saw / decided on in the old workflow.
--
-- Distinct from `submissions` because these events never went through the
-- new-platform queue and shouldn't clutter the admin view.

create table if not exists ingestion_history (
  id uuid primary key default uuid_generate_v4(),
  source_name text not null,
  title text not null,
  event_date text,                              -- 'M/D/YYYY' as-emitted by runner.py
  event_time text,                              -- 'H:MM AM/PM' as-emitted
  event_url text,
  first_seen_at timestamptz not null default now(),
  raw jsonb                                     -- entire original row for archive
);

create index if not exists ingestion_history_dedup_idx
  on ingestion_history (source_name, title, event_date);

-- ---- 4. RLS ------------------------------------------------------------------

alter table ingestion_runs enable row level security;
alter table ingestion_history enable row level security;

-- Admins can read runs; service role bypasses RLS.
create policy "Admins can read ingestion runs"
  on ingestion_runs for select using (is_admin());

create policy "Admins can read ingestion history"
  on ingestion_history for select using (is_admin());

-- No public write. All ingestion writes come through the service role via
-- the /api/ingest/* endpoints, which authenticate via bearer token.

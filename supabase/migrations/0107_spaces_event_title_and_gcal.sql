-- ============================================================
-- 0107_spaces_event_title_and_gcal.sql
--
-- Three additions to the spaces module:
--   1. `spaces_reservations.event_title` — short user-facing title
--      asked for on the reserve form. Also used as the Google
--      Calendar event summary when we push a confirmed reservation.
--   2. Two-way Google Calendar sync scaffolding:
--        - `spaces_reservations.origin`  (web | gcal) so we can tell
--          calendar-originated reservations apart from web requests.
--        - `spaces_reservations.gcal_event_id` (idempotency key for
--          push AND pull; unique so pull-side upsert is a no-op on
--          rows we created ourselves).
--        - `spaces_reservations.gcal_html_link` for a direct
--          calendar link in the admin UI.
--        - `spaces_gcal_sync_state` — one-row table holding the
--          latest Google Calendar delta syncToken. First cron run
--          bootstraps via a full list; every subsequent run passes
--          the token for a cheap delta read.
--   3. Seeds three new spaces_settings keys so admins can toggle
--      push/pull and point at a different calendar without a code
--      change.
-- ============================================================

-- ---------- Columns ----------

alter table public.spaces_reservations
  add column if not exists event_title text,
  add column if not exists origin text not null default 'web',
  add column if not exists gcal_event_id text,
  add column if not exists gcal_html_link text;

-- Enforce the two known origin values. Kept as a text column with a
-- check constraint (not an enum) so future values are cheap to add.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'spaces_reservations_origin_check'
  ) then
    alter table public.spaces_reservations
      add constraint spaces_reservations_origin_check
      check (origin in ('web', 'gcal'));
  end if;
end $$;

-- Unique index (nullable-safe: only enforced when gcal_event_id is set)
-- so the pull-side upsert can rely on it and we can never accidentally
-- create two DB rows for the same Google Calendar event.
create unique index if not exists spaces_reservations_gcal_event_id_uniq
  on public.spaces_reservations (gcal_event_id)
  where gcal_event_id is not null;

-- ---------- Sync-state table ----------

create table if not exists public.spaces_gcal_sync_state (
  id int primary key default 1 check (id = 1),
  sync_token text,
  last_full_sync_at timestamptz,
  last_delta_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Seed the single row so upserts don't need to think about it.
insert into public.spaces_gcal_sync_state (id) values (1)
  on conflict (id) do nothing;

-- RLS: admin-only. The service-role client used by the cron bypasses
-- RLS entirely, so we just deny everything else.
alter table public.spaces_gcal_sync_state enable row level security;
drop policy if exists spaces_gcal_sync_state_no_access
  on public.spaces_gcal_sync_state;
create policy spaces_gcal_sync_state_no_access
  on public.spaces_gcal_sync_state
  for all
  using (false)
  with check (false);

-- ---------- Settings seeds ----------

insert into public.spaces_settings (key, value, notes) values
  ('gcal_calendar_id',
   to_jsonb('c_205cbf9cbcafa7878b9e27822c0e9ac3136a04fc87b3de5bc8b110c1d92b6d60@group.calendar.google.com'::text),
   'Google Calendar ID that confirmed reservations are pushed to, and that inbound events are pulled from. Set empty to disable both sides.'),
  ('gcal_push_enabled',
   to_jsonb(true),
   'When true, transitioning a reservation to Confirmed pushes an event to gcal_calendar_id.'),
  ('gcal_pull_enabled',
   to_jsonb(true),
   'When true, the daily cron pulls events from gcal_calendar_id and creates confirmed reservations with origin=gcal.')
on conflict (key) do nothing;

-- Replace the over-tight unique constraint on (publication_date, edition,
-- status) with a partial unique index that only fires for terminal-success
-- statuses ('sent' and 'mirrored'). Retries after a mid-pipeline failure
-- must be allowed; the original constraint blocked them because any two
-- in-progress rows at the same status (e.g. both 'fetched') would collide.
--
-- Duplicate-send protection is preserved: a row can only reach status='sent'
-- or 'mirrored' if the compose route successfully rendered AND the send
-- route persisted a `daybook_sends` row (which has its own UNIQUE guard on
-- (edition, publication_date)).

begin;

alter table daybook_runs
  drop constraint if exists daybook_runs_one_success;

-- Partial unique index: at most one non-failed terminal row per (date, edition).
create unique index if not exists daybook_runs_one_terminal
  on daybook_runs (publication_date, edition)
  where status in ('sent', 'mirrored');

commit;

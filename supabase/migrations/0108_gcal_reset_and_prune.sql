-- 0108_gcal_reset_and_prune.sql
--
-- Follow-up to 0107. On 2026-09-04 we bootstrapped the gcal pull
-- with no `timeMax` bound, so a single weekly recurring event on the
-- MIP calendar expanded (via `singleEvents=true`) into 224 forward-
-- dated reservations spanning years into the future.
--
-- The new `pullGcalEvents` code caps the bootstrap window at
-- `[now, now + 90 days]`. This migration:
--
--   1. Deletes origin='gcal' reservations whose start is more than
--      90 days from now. Reservations inside the window are kept
--      (the user confirmed the near-term recurring instances are
--      working as intended).
--   2. Resets the persisted sync token so the next cron run
--      re-bootstraps against the same 90-day window and starts
--      producing correct delta reads from there.
--
-- Safe to re-run: the DELETE narrows itself over time as `now`
-- advances (rows that were outside the window remain gone, no new
-- ones enter it); the UPDATE is idempotent.
--
-- We intentionally do NOT touch origin='web' reservations \u2014 those
-- are user-submitted approvals whose push-to-gcal is unaffected.

DELETE FROM spaces_reservations
WHERE origin = 'gcal'
  AND event_start_at > (NOW() + INTERVAL '90 days');

UPDATE spaces_gcal_sync_state
SET sync_token = NULL,
    last_full_sync_at = NULL,
    last_delta_sync_at = NULL,
    updated_at = NOW()
WHERE id = 1;

-- Notion task page IDs created for each gear request, so later events
-- (approval, follow-up sent) can mark the matching task Done.
alter table gear_reservations
  add column if not exists notion_confirm_task_id  text,
  add column if not exists notion_prep_task_id     text,
  add column if not exists notion_followup_task_id text;

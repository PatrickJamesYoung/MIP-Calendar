-- Audit log of organizer actions on gear reservations.
-- Applied to calendar prod via Supabase MCP on 2026-08-07.

create table if not exists gear_activity (
  id uuid primary key default uuid_generate_v4(),
  reservation_id uuid not null references gear_reservations(id) on delete cascade,
  actor_email text,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gear_activity_reservation_id_idx on gear_activity(reservation_id, created_at desc);

alter table gear_activity enable row level security;

create policy gear_activity_admin_read on gear_activity
  for select using (is_admin());

create policy gear_activity_admin_insert on gear_activity
  for insert with check (is_admin());

comment on table gear_activity is 'Audit log of organizer actions on gear reservations. Append-only.';

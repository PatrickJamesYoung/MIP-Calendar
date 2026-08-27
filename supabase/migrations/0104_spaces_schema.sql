-- MIP Space Reservations — base schema
--
-- Parallel module to gear (0100-0103). Structurally similar but:
--   * Spaces are the catalog unit (like gear_items) — no bundles.
--   * Reservations track FOUR timestamps: load_in / event_start /
--     event_end / load_out. Recommended donation is calculated on
--     (load_out - load_in), floored to a minimum number of hours,
--     multiplied by the sum of per-space hourly rates on the request.
--   * Storefront settings include a rich-HTML info panel that
--     renders above the space grid.
--   * Emails follow the same PR B pipeline (Gmail-first, poller
--     picks up replies) but log to a separate spaces_email_messages
--     table so gear and space concerns don't cross-contaminate.

create extension if not exists "uuid-ossp";

-- ============================================================
-- Enums
-- ============================================================

do $$ begin
  create type space_reservation_status as enum (
    'tentative', 'approved', 'denied', 'in_use', 'completed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ============================================================
-- spaces — catalog
-- ============================================================

create table if not exists spaces (
  id uuid primary key default uuid_generate_v4(),
  slug text not null unique,
  name text not null,
  category text,
  capacity int check (capacity is null or capacity >= 0),
  suggested_contribution_per_hour numeric not null default 0
    check (suggested_contribution_per_hour >= 0),
  short_description text,
  how_to_use_url text,
  photo_url text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spaces_active_idx on spaces(active) where active;
create index if not exists spaces_category_idx on spaces(category);

-- ============================================================
-- spaces_reservations — one row per public request
-- ============================================================

create table if not exists spaces_reservations (
  id uuid primary key default uuid_generate_v4(),
  human_id text not null unique,                              -- e.g. SPACE-20260827-A1B2
  status space_reservation_status not null default 'tentative',

  -- Requester
  requester_name text not null,
  requester_email text not null,
  requester_phone text,
  organization text,
  org_tier text,                                              -- reuses gear tier vocab
  event_description text,

  -- Timing (four timestamps)
  load_in_at    timestamptz not null,
  event_start_at timestamptz not null,
  event_end_at   timestamptz not null,
  load_out_at    timestamptz not null,

  -- Money (denormalized at submit time so email math never drifts)
  -- hours_billed is the actual number used in the calculation after
  -- flooring to spaces_settings.donation_min_hours. Kept explicit so
  -- the email can say "billed for 2 hours (2-hour minimum)".
  hours_billed numeric not null default 0 check (hours_billed >= 0),
  subtotal_full numeric not null default 0 check (subtotal_full >= 0),
  contribution_multiplier numeric not null default 1 check (contribution_multiplier >= 0),
  contribution_total numeric not null default 0 check (contribution_total >= 0),
  coupon_code text,

  -- Acknowledgements
  acknowledged_tentative boolean not null default false,
  internal_notes text,

  -- Approval / denial
  approve_token text unique,
  approved_at timestamptz,
  approved_by uuid references admins(id) on delete set null,
  denied_at timestamptz,
  denied_by uuid references admins(id) on delete set null,
  decision_email_subject text,
  decision_email_body text,

  -- Post-event follow-up
  followup_scheduled_at timestamptz,
  followup_sent_at timestamptz,
  followup_email_subject text,
  followup_email_body text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (event_start_at >= load_in_at),
  check (event_end_at   >  event_start_at),
  check (load_out_at   >= event_end_at)
);

create index if not exists spaces_reservations_status_idx on spaces_reservations(status);
create index if not exists spaces_reservations_load_in_idx on spaces_reservations(load_in_at);
create index if not exists spaces_reservations_load_out_idx on spaces_reservations(load_out_at);
create index if not exists spaces_reservations_requester_email_idx
  on spaces_reservations(lower(requester_email));

-- ============================================================
-- spaces_reservation_lines — one row per space on a reservation
-- ============================================================
-- Multi-space reservations are supported. Each line snapshots the
-- space name and per-hour rate at submit time so future rate changes
-- don't rewrite historical requests.

create table if not exists spaces_reservation_lines (
  id uuid primary key default uuid_generate_v4(),
  reservation_id uuid not null references spaces_reservations(id) on delete cascade,
  space_id uuid references spaces(id) on delete restrict,
  name_snapshot text not null,
  rate_per_hour numeric not null default 0 check (rate_per_hour >= 0),
  hours_billed numeric not null default 0 check (hours_billed >= 0),
  line_full numeric not null default 0 check (line_full >= 0),
  created_at timestamptz not null default now()
);

create index if not exists spaces_reservation_lines_res_idx
  on spaces_reservation_lines(reservation_id);
create index if not exists spaces_reservation_lines_space_idx
  on spaces_reservation_lines(space_id) where space_id is not null;

-- ============================================================
-- spaces_settings — key/value tunables
-- ============================================================

create table if not exists spaces_settings (
  key text primary key,
  value jsonb not null,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references admins(id) on delete set null
);

-- ============================================================
-- spaces_email_templates — canonical drafts
-- ============================================================

create table if not exists spaces_email_templates (
  key text primary key,
  label text not null,
  description text,
  placeholders text[] not null default '{}',
  subject text,
  body text,
  updated_at timestamptz not null default now(),
  updated_by uuid references admins(id) on delete set null
);

-- ============================================================
-- spaces_activity — audit log
-- ============================================================

create table if not exists spaces_activity (
  id uuid primary key default uuid_generate_v4(),
  reservation_id uuid not null references spaces_reservations(id) on delete cascade,
  actor_email text,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists spaces_activity_reservation_id_idx
  on spaces_activity(reservation_id, created_at desc);

-- ============================================================
-- spaces_email_messages — every email sent or received
-- ============================================================
-- Mirrors gear_email_messages exactly. Separate table (not a
-- discriminator column) so the two modules stay decoupled and each
-- module's queries stay simple.

create table if not exists public.spaces_email_messages (
  id                uuid primary key default gen_random_uuid(),
  reservation_id    uuid references public.spaces_reservations(id) on delete cascade,
  direction         text not null check (direction in ('outbound', 'inbound')),
  transport         text not null check (transport in ('gmail', 'resend')),
  gmail_message_id  text,
  gmail_thread_id   text,
  in_reply_to       text,
  from_address      text not null,
  to_address        text not null,
  cc_address        text,
  reply_to          text,
  subject           text not null,
  body_text         text not null default '',
  body_html         text,
  template_key      text,
  actor_email       text,
  sent_at           timestamptz,
  received_at       timestamptz,
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists spaces_email_messages_reservation_created_idx
  on public.spaces_email_messages (reservation_id, created_at desc);

create index if not exists spaces_email_messages_thread_idx
  on public.spaces_email_messages (gmail_thread_id)
  where gmail_thread_id is not null;

create unique index if not exists spaces_email_messages_gmail_message_id_uidx
  on public.spaces_email_messages (gmail_message_id)
  where gmail_message_id is not null;

comment on table public.spaces_email_messages is
  'All email sent or received for a space reservation. Populated by the admin send flow and by inbound Gmail polling.';

-- ============================================================
-- Triggers
-- ============================================================

drop trigger if exists spaces_set_updated_at on spaces;
create trigger spaces_set_updated_at before update on spaces
  for each row execute function set_updated_at();

drop trigger if exists spaces_reservations_set_updated_at on spaces_reservations;
create trigger spaces_reservations_set_updated_at before update on spaces_reservations
  for each row execute function set_updated_at();

drop trigger if exists spaces_settings_set_updated_at on spaces_settings;
create trigger spaces_settings_set_updated_at before update on spaces_settings
  for each row execute function set_updated_at();

drop trigger if exists spaces_email_templates_set_updated_at on spaces_email_templates;
create trigger spaces_email_templates_set_updated_at before update on spaces_email_templates
  for each row execute function set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table spaces                     enable row level security;
alter table spaces_reservations        enable row level security;
alter table spaces_reservation_lines   enable row level security;
alter table spaces_settings            enable row level security;
alter table spaces_email_templates     enable row level security;
alter table spaces_activity            enable row level security;
-- spaces_email_messages: no RLS, server-only via service-role, matches gear_email_messages.

drop policy if exists spaces_public_read on spaces;
create policy spaces_public_read on spaces
  for select using (active);

drop policy if exists spaces_admin_all on spaces;
create policy spaces_admin_all on spaces
  for all using (is_admin()) with check (is_admin());

drop policy if exists spaces_reservations_public_insert on spaces_reservations;
create policy spaces_reservations_public_insert on spaces_reservations
  for insert with check (true);

drop policy if exists spaces_reservations_admin_all on spaces_reservations;
create policy spaces_reservations_admin_all on spaces_reservations
  for all using (is_admin()) with check (is_admin());

drop policy if exists spaces_reservation_lines_public_insert on spaces_reservation_lines;
create policy spaces_reservation_lines_public_insert on spaces_reservation_lines
  for insert with check (
    exists (select 1 from spaces_reservations r where r.id = spaces_reservation_lines.reservation_id)
  );

drop policy if exists spaces_reservation_lines_admin_all on spaces_reservation_lines;
create policy spaces_reservation_lines_admin_all on spaces_reservation_lines
  for all using (is_admin()) with check (is_admin());

drop policy if exists spaces_settings_admin_all on spaces_settings;
create policy spaces_settings_admin_all on spaces_settings
  for all using (is_admin()) with check (is_admin());

-- Public reads a subset of settings so the storefront can render the
-- info panel and tier caveats. Read-only.
drop policy if exists spaces_settings_public_read_public_keys on spaces_settings;
create policy spaces_settings_public_read_public_keys on spaces_settings
  for select using (
    key in ('storefront_info_html', 'donation_min_hours', 'donation_disclaimer')
  );

drop policy if exists spaces_email_templates_admin_all on spaces_email_templates;
create policy spaces_email_templates_admin_all on spaces_email_templates
  for all using (is_admin()) with check (is_admin());

drop policy if exists spaces_activity_admin_read on spaces_activity;
create policy spaces_activity_admin_read on spaces_activity
  for select using (is_admin());

drop policy if exists spaces_activity_admin_insert on spaces_activity;
create policy spaces_activity_admin_insert on spaces_activity
  for insert with check (is_admin());

-- ============================================================
-- Seed: spaces_settings baseline
-- ============================================================

insert into spaces_settings (key, value, notes) values
  ('storefront_info_html',
   to_jsonb('<p>Welcome. Use the form below to request space at our building.</p>'::text),
   'Rich HTML shown above the space grid on the public storefront.'),
  ('donation_min_hours',
   to_jsonb(2),
   'Minimum number of hours billed on any reservation. Prevents a 30-minute request from generating a token donation ask.'),
  ('donation_disclaimer',
   to_jsonb('Recommended donations are suggested, not required. Contact us if cost is a barrier.'::text),
   'Copy shown under the donation summary on the request form.'),
  ('reservation_id_prefix',
   to_jsonb('SPACE'::text),
   'Prefix used when minting human_id values, e.g. SPACE-20260827-A1B2.')
on conflict (key) do nothing;

-- ============================================================
-- Seed: placeholder email templates
-- ============================================================
-- Marked "PLACEHOLDER — REPLACE ME" so it's obvious the copy needs to
-- be written before real requests get sent these emails. The dispatch
-- pipeline works regardless — the templates are just drafts users
-- edit in /admin/spaces/templates.

insert into spaces_email_templates (key, label, description, placeholders, subject, body) values
  ('submission_ack',
   'Submission acknowledgement',
   'Auto-sent to the requester right after they submit the request form.',
   array['requester_name', 'human_id', 'load_in_at', 'event_start_at', 'event_end_at', 'load_out_at', 'space_names', 'contribution_total'],
   'PLACEHOLDER — REPLACE ME · Your space request was received',
   E'PLACEHOLDER — REPLACE ME\n\nHi {{requester_name}},\n\nWe received your request ({{human_id}}) for {{space_names}}.\n\n  Load-in:  {{load_in_at}}\n  Event:    {{event_start_at}} — {{event_end_at}}\n  Load-out: {{load_out_at}}\n\nSuggested contribution: ${{contribution_total}}.\n\nWe''ll follow up shortly with a confirmation.'),
  ('approve',
   'Approved',
   'Sent when an admin approves a request.',
   array['requester_name', 'human_id', 'load_in_at', 'event_start_at', 'event_end_at', 'load_out_at', 'space_names'],
   'PLACEHOLDER — REPLACE ME · Your space request is confirmed',
   E'PLACEHOLDER — REPLACE ME\n\nHi {{requester_name}},\n\nYour request ({{human_id}}) is confirmed for {{space_names}}.\n\nSee you at {{load_in_at}}.'),
  ('deny',
   'Denied',
   'Sent when an admin denies a request. Include a reason.',
   array['requester_name', 'human_id'],
   'PLACEHOLDER — REPLACE ME · About your space request',
   E'PLACEHOLDER — REPLACE ME\n\nHi {{requester_name}},\n\nUnfortunately we''re unable to accommodate request {{human_id}}.'),
  ('followup',
   'Post-event follow-up',
   'Sent after the event ends, e.g. thank-you note or donation reminder.',
   array['requester_name', 'human_id', 'contribution_total'],
   'PLACEHOLDER — REPLACE ME · Thanks for using our space',
   E'PLACEHOLDER — REPLACE ME\n\nHi {{requester_name}},\n\nThanks for using our building for {{human_id}}.')
on conflict (key) do nothing;

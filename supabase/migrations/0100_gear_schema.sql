-- MIP Gear Library — base schema
--
-- IMPORTANT: This migration was reconstructed on 2026-08-12 by inspecting the
-- applied production schema (Supabase project oqnratorzgejmjqzyubi). The
-- original 0100 was applied via Supabase Studio and never committed. The
-- shape below matches what is currently live in prod. Once this file is in
-- the repo, subsequent gear migrations (0101, 0102) build on top of it as
-- they already do.
--
-- Design decisions preserved from the original:
--   * gear_items: physical inventory. `slug` is the stable public identifier.
--     Photos and how-to links are optional. Contribution is per-event by
--     default; `unit` allows per_day / per_week for future items.
--   * gear_bundles + gear_bundle_components: pre-packaged kits. When a bundle
--     is added to a reservation it expands into per-item lines at cart time
--     so we can track inventory availability at the item level. The parent
--     bundle line is retained on the reservation (line_type='bundle') so we
--     can render "1 x Rally Kit ($X)" in emails.
--   * gear_reservations + gear_reservation_lines: reservation header + lines.
--     Contribution math is stored fully denormalized on both the line
--     (line_full) and the reservation (subtotal_full, contribution_total)
--     so the numbers on the confirmation email never drift from what the
--     requester saw at submit time.
--   * gear_settings: single-row key/value config (jsonb). Used for tunable
--     policy — donation URL, buffer hours, min notice, org tier multipliers.
--   * gear_email_templates + gear_email_log: templates for the four canonical
--     email steps (submission_ack, approve, deny, followup) plus a log of
--     everything actually sent (with Resend message id).
--   * RLS: admins have full access. Public users can INSERT reservations and
--     reservation_lines (open storefront), and SELECT active items/bundles
--     for browsing. Public cannot read reservations, activity, email logs,
--     or settings.
--
-- Prefixed gear_* to coexist with events, submissions, wiki_*, etc. in the
-- shared Supabase project.

create extension if not exists "uuid-ossp";

-- ============================================================
-- Enums
-- ============================================================

do $$ begin
  create type gear_unit as enum ('per_event', 'per_day', 'per_week');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gear_reservation_status as enum (
    'tentative', 'approved', 'denied', 'picked_up', 'returned', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type gear_line_type as enum ('item', 'bundle');
exception when duplicate_object then null; end $$;

-- ============================================================
-- gear_items — physical inventory
-- ============================================================

create table if not exists gear_items (
  id uuid primary key default uuid_generate_v4(),
  slug text not null unique,
  name text not null,
  category text,
  quantity_total int not null default 1 check (quantity_total >= 0),
  suggested_contribution numeric not null default 0 check (suggested_contribution >= 0),
  unit gear_unit not null default 'per_event',
  short_description text,
  how_to_use_url text,
  photo_url text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- follow_up_question, requires_electricity added in 0102
);

create index if not exists gear_items_active_idx on gear_items(active) where active;
create index if not exists gear_items_category_idx on gear_items(category);

-- ============================================================
-- gear_bundles + gear_bundle_components — packaged kits
-- ============================================================

create table if not exists gear_bundles (
  id uuid primary key default uuid_generate_v4(),
  slug text not null unique,
  name text not null,
  category text,
  suggested_contribution numeric not null default 0 check (suggested_contribution >= 0),
  unit gear_unit not null default 'per_event',
  short_description text,
  how_to_use_url text,
  photo_url text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gear_bundles_active_idx on gear_bundles(active) where active;

create table if not exists gear_bundle_components (
  id uuid primary key default uuid_generate_v4(),
  bundle_id uuid not null references gear_bundles(id) on delete cascade,
  item_id uuid not null references gear_items(id) on delete restrict,
  quantity int not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (bundle_id, item_id)
);

create index if not exists gear_bundle_components_bundle_idx on gear_bundle_components(bundle_id);
create index if not exists gear_bundle_components_item_idx on gear_bundle_components(item_id);

-- ============================================================
-- gear_reservations — one row per public request
-- ============================================================

create table if not exists gear_reservations (
  id uuid primary key default uuid_generate_v4(),
  human_id text not null unique,                              -- e.g. GEAR-2026-001
  status gear_reservation_status not null default 'tentative',

  -- Requester
  requester_name text not null,
  requester_email text not null,
  requester_phone text,
  organization text,
  org_tier text,                                              -- 'full' | 'mid' | 'low' | 'free' | 'sliding' | 'premium'
  event_description text,

  -- Timing
  pickup_at timestamptz not null,
  return_at timestamptz not null,
  pickup_location text,
  organizer_contact_name text,
  organizer_contact_phone text,

  -- Money (denormalized at submit time so email math never drifts)
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

  -- Post-return follow-up
  followup_scheduled_at timestamptz,
  followup_sent_at timestamptz,
  followup_email_subject text,
  followup_email_body text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (return_at > pickup_at)
);

create index if not exists gear_reservations_status_idx on gear_reservations(status);
create index if not exists gear_reservations_pickup_at_idx on gear_reservations(pickup_at);
create index if not exists gear_reservations_return_at_idx on gear_reservations(return_at);
create index if not exists gear_reservations_requester_email_idx on gear_reservations(lower(requester_email));

-- ============================================================
-- gear_reservation_lines — items and bundles on a reservation
-- ============================================================

create table if not exists gear_reservation_lines (
  id uuid primary key default uuid_generate_v4(),
  reservation_id uuid not null references gear_reservations(id) on delete cascade,
  line_type gear_line_type not null,
  item_id uuid references gear_items(id) on delete restrict,
  bundle_id uuid references gear_bundles(id) on delete restrict,
  name_snapshot text not null,                                -- name at submit time
  quantity int not null check (quantity > 0),
  unit_contribution numeric not null default 0 check (unit_contribution >= 0),
  line_full numeric not null default 0 check (line_full >= 0),
  -- When a bundle is added, its components are also inserted as line_type='item'
  -- rows with expanded_from_bundle_line_id pointing to the parent bundle line.
  expanded_from_bundle_line_id uuid references gear_reservation_lines(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Exactly one of item_id / bundle_id must be set, matching line_type
  check (
    (line_type = 'item'   and item_id is not null and bundle_id is null) or
    (line_type = 'bundle' and bundle_id is not null and item_id is null)
  )
  -- follow_up_answer added in 0102
);

create index if not exists gear_reservation_lines_res_idx on gear_reservation_lines(reservation_id);
create index if not exists gear_reservation_lines_item_idx on gear_reservation_lines(item_id) where item_id is not null;
create index if not exists gear_reservation_lines_bundle_idx on gear_reservation_lines(bundle_id) where bundle_id is not null;

-- ============================================================
-- gear_settings — key/value tunables (single row per key)
-- ============================================================

create table if not exists gear_settings (
  key text primary key,
  value jsonb not null,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references admins(id) on delete set null
);

-- ============================================================
-- gear_email_templates — drafts for the four canonical steps
-- ============================================================

create table if not exists gear_email_templates (
  key text primary key,                                        -- 'submission_ack' | 'approve' | 'deny' | 'followup'
  label text not null,
  description text,
  placeholders text[] not null default '{}',
  subject text,
  body text,
  updated_at timestamptz not null default now(),
  updated_by uuid references admins(id) on delete set null
);

-- ============================================================
-- gear_email_log — every email actually sent
-- ============================================================

create table if not exists gear_email_log (
  id uuid primary key default uuid_generate_v4(),
  reservation_id uuid references gear_reservations(id) on delete cascade,
  template_key text,
  to_email text not null,
  subject text,
  status text not null,                                        -- 'sent' | 'failed' | 'queued'
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists gear_email_log_res_idx on gear_email_log(reservation_id);
create index if not exists gear_email_log_created_at_idx on gear_email_log(created_at desc);

-- ============================================================
-- Triggers: keep updated_at fresh on the mutable tables
-- ============================================================
-- set_updated_at() is defined in 0001_initial_schema.sql

drop trigger if exists gear_items_set_updated_at on gear_items;
create trigger gear_items_set_updated_at before update on gear_items
  for each row execute function set_updated_at();

drop trigger if exists gear_bundles_set_updated_at on gear_bundles;
create trigger gear_bundles_set_updated_at before update on gear_bundles
  for each row execute function set_updated_at();

drop trigger if exists gear_reservations_set_updated_at on gear_reservations;
create trigger gear_reservations_set_updated_at before update on gear_reservations
  for each row execute function set_updated_at();

drop trigger if exists gear_settings_set_updated_at on gear_settings;
create trigger gear_settings_set_updated_at before update on gear_settings
  for each row execute function set_updated_at();

drop trigger if exists gear_email_templates_set_updated_at on gear_email_templates;
create trigger gear_email_templates_set_updated_at before update on gear_email_templates
  for each row execute function set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
-- Public can browse active catalog and INSERT reservations; admins have full
-- access via is_admin(). Public cannot read reservations, activity, email
-- logs, settings, or templates.

alter table gear_items                enable row level security;
alter table gear_bundles              enable row level security;
alter table gear_bundle_components    enable row level security;
alter table gear_reservations         enable row level security;
alter table gear_reservation_lines    enable row level security;
alter table gear_settings             enable row level security;
alter table gear_email_templates      enable row level security;
alter table gear_email_log            enable row level security;

-- gear_items: public reads active items, admins do everything
drop policy if exists gear_items_public_read on gear_items;
create policy gear_items_public_read on gear_items
  for select using (active);

drop policy if exists gear_items_admin_all on gear_items;
create policy gear_items_admin_all on gear_items
  for all using (is_admin()) with check (is_admin());

-- gear_bundles: public reads active bundles, admins do everything
drop policy if exists gear_bundles_public_read on gear_bundles;
create policy gear_bundles_public_read on gear_bundles
  for select using (active);

drop policy if exists gear_bundles_admin_all on gear_bundles;
create policy gear_bundles_admin_all on gear_bundles
  for all using (is_admin()) with check (is_admin());

-- gear_bundle_components: public can read components of active bundles
drop policy if exists gear_bundle_components_public_read on gear_bundle_components;
create policy gear_bundle_components_public_read on gear_bundle_components
  for select using (
    exists (select 1 from gear_bundles b where b.id = gear_bundle_components.bundle_id and b.active)
  );

drop policy if exists gear_bundle_components_admin_all on gear_bundle_components;
create policy gear_bundle_components_admin_all on gear_bundle_components
  for all using (is_admin()) with check (is_admin());

-- gear_reservations: public INSERT only; admins do everything
drop policy if exists gear_reservations_public_insert on gear_reservations;
create policy gear_reservations_public_insert on gear_reservations
  for insert with check (true);

drop policy if exists gear_reservations_admin_all on gear_reservations;
create policy gear_reservations_admin_all on gear_reservations
  for all using (is_admin()) with check (is_admin());

-- gear_reservation_lines: public INSERT only, must reference existing reservation
drop policy if exists gear_reservation_lines_public_insert on gear_reservation_lines;
create policy gear_reservation_lines_public_insert on gear_reservation_lines
  for insert with check (
    exists (select 1 from gear_reservations r where r.id = gear_reservation_lines.reservation_id)
  );

drop policy if exists gear_reservation_lines_admin_all on gear_reservation_lines;
create policy gear_reservation_lines_admin_all on gear_reservation_lines
  for all using (is_admin()) with check (is_admin());

-- Admin-only tables
drop policy if exists gear_settings_admin_all on gear_settings;
create policy gear_settings_admin_all on gear_settings
  for all using (is_admin()) with check (is_admin());

drop policy if exists gear_email_templates_admin_all on gear_email_templates;
create policy gear_email_templates_admin_all on gear_email_templates
  for all using (is_admin()) with check (is_admin());

drop policy if exists gear_email_log_admin_all on gear_email_log;
create policy gear_email_log_admin_all on gear_email_log
  for all using (is_admin()) with check (is_admin());

-- ============================================================
-- Seed: gear_settings (baseline policy tunables)
-- ============================================================

insert into gear_settings (key, value, notes) values
  ('organization_name', '"Movement Infrastructure Project"'::jsonb,
    'Shown in the catalog header and emails'),
  ('email_from_name', '"MIP Gear Library"'::jsonb,
    'From-name on outgoing email'),
  ('organizer_emails', '["info@movementinfrastructureproject.org"]'::jsonb,
    'Comma-separated list of who receives new-request emails'),
  ('donation_url', '"https://www.movementinfrastructureproject.org/donate"'::jsonb,
    'Donation link included in confirmation and follow-up emails'),
  ('storefront_base_url', '""'::jsonb,
    'Public URL of the storefront (used in confirmation emails)'),
  ('approval_base_url', '""'::jsonb,
    'Public URL of the Apps Script Web App (auto-populated on first deploy)'),
  ('admin_link', '""'::jsonb, null),
  ('admin_token', '""'::jsonb, null),
  ('pipedream_webhook_url', '""'::jsonb,
    'Optional Pipedream endpoint that will receive JSON on every new request'),

  ('buffer_hours', '4'::jsonb,
    'Padding added before and after each reservation for prep and return'),
  ('min_notice_hours', '48'::jsonb,
    'Reject requests submitted less than this many hours before pickup'),
  ('followup_days_after_return', '2'::jsonb,
    'Number of days after the return date to send the thank-you/donation follow-up email (blank or 0 disables follow-ups)'),
  ('followup_delay_days', '3'::jsonb,
    'Days after return_at before the follow-up email fires'),

  ('tentative_disclaimer',
    '"This booking request isn''t confirmed until an organizer follows up."'::jsonb,
    'Shown on checkout and in confirmation email'),

  -- Contribution tiers (labels + multipliers), plus a jsonb map for org_tier lookup
  ('tier_full_label',
    '"We''re a larger or well-resourced organization and can contribute the amount listed."'::jsonb,
    'Tier 1 label'),
  ('tier_full_multiplier', '1'::jsonb, 'Tier 1 multiplier'),
  ('tier_mid_label',
    '"We''re a smaller grassroots organization and can contribute 85% of the amount listed."'::jsonb,
    'Tier 2 label'),
  ('tier_mid_multiplier', '0.85'::jsonb, 'Tier 2 multiplier'),
  ('tier_low_label',
    '"We''re a very small organization with no full-time staff and can contribute 65% of the amount listed."'::jsonb,
    'Tier 3 label'),
  ('tier_low_multiplier', '0.65'::jsonb, 'Tier 3 multiplier'),
  ('tier_multipliers',
    '{"free": 0, "sliding": 0.5, "standard": 1, "premium": 1.25}'::jsonb,
    'Multipliers applied to subtotal_full to compute contribution_total, keyed by org_tier'),

  ('default_pickup_location', '""'::jsonb,
    'Optional: pre-fills the pickup location on the approval review page'),
  ('default_organizer_contact_name', '""'::jsonb,
    'Optional: pre-fills on-site contact name on the approval review page'),
  ('default_organizer_contact_phone', '""'::jsonb,
    'Optional: pre-fills on-site contact phone on the approval review page')
on conflict (key) do nothing;

-- ============================================================
-- Seed: gear_email_templates (drafts editable in Admin UI)
-- ============================================================

insert into gear_email_templates (key, label, description, placeholders, subject, body) values
  ('submission_ack',
   'Submission acknowledgment',
   'Sent to the requester right after they submit. Confirms we got the request and it is tentative.',
   array['requester_name','reservation_id','organization_name','pickup_at','return_at','contribution_total','gear_lines','tentative_disclaimer'],
   'MIP gear request received — {{reservation_id}}',
   E'Hi {{requester_name}},\n\nThanks for requesting gear from the {{organization_name}} library. Your request is TENTATIVE until an organizer confirms — expect a reply within a day or two.\n\nReference: {{reservation_id}}\nPickup:  {{pickup_at}}\nReturn:  {{return_at}}\nSuggested contribution: ${{contribution_total}}\n\nGear:\n{{gear_lines}}\n\n{{tentative_disclaimer}}\n\n— {{organization_name}}'
  ),
  ('approve',
   'Approval email (draft)',
   'Pre-fills the approval draft on the review page. You can still edit before sending.',
   array['requester_name','reservation_id','organization_name','pickup_at','return_at','contribution_total','gear_lines','donation_url','event_description','organization'],
   'Your MIP gear request is confirmed — {{reservation_id}}',
   E'Hi {{requester_name}},\n\nWe''re writing to let you know that your request is confirmed!\n\nGEAR RESERVED\n{{gear_lines}}\n\nThe Movement Infrastructure Project is an all-volunteer resource. To help keep this work going we ask partners to make a donation when using our resources. The recommended contribution for this project is: ${{contribution_total}}. You can donate here: {{donation_url}}\n\nPICKING UP YOUR GEAR\nTo pick up your gear, please access the white trailer located behind 33 Grant Circle NW (Petworth United Methodist Church). The best way to access the trailer is to take the alley off Varnum Street, next to the house with a purple fence (508 Varnum St NW).\n\nThe lock is a combination lock. The code is 0820. To open the lock, enter the combination, then pull down. When you have successfully picked up your gear, email info@movementinfrastructureproject.org. Please re-lock the trailer and scramble the lock (select a random combination to hide the code).\n\nThe gear you are borrowing should be in good condition, but with many different individuals and organizations borrowing it with limited oversight by our volunteer team, some issues may have arisen. This includes missing items, damage to items, or items placed in strange locations in the trailer. Please allot plenty of time to locate the gear during your pick up and test it before you need to use it.\n\nRETURNING YOUR GEAR\nWhen you return the gear, please place it in the same location in the trailer. Mark any damaged gear with the provided tape and marker (feel free to also let us know by email).\n\nPlease send us a picture at info@movementinfrastructureproject.org of the gear back in the trailer to close your reservation. Please re-lock the trailer and scramble the lock when you are finished.\n\nYou may receive an invoice via email after your rental is complete.\n\nLet us know if you have questions at info@movementinfrastructureproject.org.\n\nIn solidarity,\nPatrick at the Movement Infrastructure Project'
  ),
  ('deny',
   'Denial email (draft)',
   'Pre-fills the denial draft on the review page. Edit before sending to add context or alternatives.',
   array['requester_name','reservation_id','organization_name','event_description','organization'],
   'Update on your MIP gear reservation {{reservation_id}}',
   E'Hi {{requester_name}},\n\nThanks for reaching out about gear for {{event_description}}. Unfortunately we''re not able to fulfill request {{reservation_id}} as submitted.\n\n[Optional: reason, alternatives, next steps]\n\nIf you''d like to discuss alternatives, reply to this email and we''ll follow up.\n\nIn solidarity,\nPatrick at the Movement Infrastructure Project'
  ),
  ('followup',
   'Post-return follow-up',
   'Sent automatically after each rental to say thanks and ask for a donation.',
   array['requester_name','reservation_id','organization_name','contribution_total','gear_lines','donation_url'],
   'Thanks for borrowing MIP gear — {{reservation_id}}',
   E'Hi {{requester_name}},\n\nThanks for reaching out for support. We hope everything went great! If you haven''t already, please make a contribution to help keep this work going.\n\nGEAR YOU BORROWED\n{{gear_lines}}\n\nRecommended contribution: ${{contribution_total}}\nDonate: {{donation_url}}\n\nThe {{organization_name}} is an all-volunteer resource. Your contribution keeps the trailer stocked and the gear moving.\n\nIn solidarity,\nPatrick at the {{organization_name}}'
  )
on conflict (key) do nothing;

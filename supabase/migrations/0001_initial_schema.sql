-- ============================================================
-- MIP Movement Calendar — Initial Schema
-- Migration 0001
-- ============================================================
-- Run this against your Supabase project via:
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
-- or via the Supabase CLI: `supabase db push`
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";  -- fuzzy search on event titles

-- ============================================================
-- ENUMS
-- ============================================================

create type location_type as enum ('in_person', 'online', 'hybrid');
create type event_status as enum ('published', 'pending', 'rejected', 'archived', 'draft');
create type event_source as enum ('admin', 'submission', 'csv', 'trumba');
create type submission_status as enum ('pending', 'approved', 'rejected', 'needs_edit', 'duplicate');
create type admin_role as enum ('super', 'admin');
create type accessibility_feature as enum (
  'asl',
  'childcare',
  'captioning',
  'physical_access',
  'elder_seating',
  'spanish',
  'other'
);

-- ============================================================
-- CORE TABLES
-- ============================================================

-- Admins whitelist. Only rows in this table can access /admin.
create table admins (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade unique,
  email text not null unique,
  display_name text,
  role admin_role not null default 'admin',
  invited_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

-- Overlay calendars (Movement, Congressional, SCOTUS, etc.)
create table overlay_calendars (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  slug text not null unique,
  color text not null,                -- hex code
  default_visible boolean not null default true,
  sort_order int not null default 0,
  description text,
  created_at timestamptz not null default now()
);

-- Event categories (Action, Meeting, Mutual Aid, etc.)
create table event_types (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  slug text not null unique,
  color text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Events (the main table)
create table events (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  slug text unique,                   -- URL-safe, auto-generated
  description text,                   -- rich text HTML from Tiptap
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  timezone text not null default 'America/New_York',
  location_type location_type,
  location_text text,
  location_lat double precision,
  location_lng double precision,
  image_url text,
  event_type_id uuid references event_types(id) on delete set null,
  cost text,
  host_org text,
  accessibility accessibility_feature[] default '{}',
  web_link text,
  overlay_calendar_id uuid references overlay_calendars(id) on delete set null,
  is_featured boolean not null default false,
  featured_until timestamptz,         -- auto-unfeature after this
  featured_sort_order int,            -- manual reorder in featured bar
  status event_status not null default 'published',
  source event_source not null default 'admin',
  external_id text,                   -- Trumba event ID for migration provenance & redirects
  rrule text,                         -- RFC 5545 recurrence rule
  created_by uuid references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common queries
create index events_starts_at_idx on events(starts_at);
create index events_status_idx on events(status);
create index events_overlay_idx on events(overlay_calendar_id);
create index events_event_type_idx on events(event_type_id);
create index events_featured_idx on events(is_featured, featured_until) where is_featured = true;
create index events_external_id_idx on events(external_id) where external_id is not null;
create index events_title_trgm_idx on events using gin (title gin_trgm_ops);
create index events_host_org_trgm_idx on events using gin (host_org gin_trgm_ops);

-- Public submissions from anonymous users
create table submissions (
  id uuid primary key default uuid_generate_v4(),
  submitter_name text not null,
  submitter_email text not null,
  submitter_phone text,
  event_payload jsonb not null,       -- full event fields as submitted
  status submission_status not null default 'pending',
  admin_notes text,
  decided_by uuid references admins(id) on delete set null,
  decided_at timestamptz,
  published_event_id uuid references events(id) on delete set null,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index submissions_status_idx on submissions(status);
create index submissions_created_at_idx on submissions(created_at desc);

-- CSV import history
create table csv_imports (
  id uuid primary key default uuid_generate_v4(),
  filename text not null,
  uploaded_by uuid references admins(id) on delete set null,
  row_count int not null default 0,
  success_count int not null default 0,
  error_count int not null default 0,
  errors jsonb,
  status text not null default 'pending',   -- pending | processing | completed | failed
  mode text not null default 'create',      -- create | update | upsert
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Audit log — every admin action
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid references admins(id) on delete set null,
  action text not null,               -- 'create' | 'update' | 'delete' | 'approve' | 'reject' | ...
  entity_type text not null,          -- 'event' | 'submission' | 'admin' | 'overlay' | 'csv_import'
  entity_id uuid,
  diff jsonb,                         -- before/after snapshot
  created_at timestamptz not null default now()
);

create index audit_log_admin_idx on audit_log(admin_id);
create index audit_log_entity_idx on audit_log(entity_type, entity_id);
create index audit_log_created_at_idx on audit_log(created_at desc);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update `updated_at` on events
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger events_set_updated_at
  before update on events
  for each row execute function set_updated_at();

-- Auto-generate slug from title if not provided
create or replace function set_event_slug()
returns trigger as $$
declare
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  if new.slug is null or new.slug = '' then
    base_slug := lower(regexp_replace(new.title, '[^a-zA-Z0-9]+', '-', 'g'));
    base_slug := trim(both '-' from base_slug);
    base_slug := left(base_slug, 60);
    final_slug := base_slug;
    while exists(select 1 from events where slug = final_slug and id != coalesce(new.id, uuid_nil())) loop
      suffix := suffix + 1;
      final_slug := base_slug || '-' || suffix;
    end loop;
    new.slug := final_slug;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger events_set_slug
  before insert or update of title on events
  for each row execute function set_event_slug();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table admins enable row level security;
alter table overlay_calendars enable row level security;
alter table event_types enable row level security;
alter table events enable row level security;
alter table submissions enable row level security;
alter table csv_imports enable row level security;
alter table audit_log enable row level security;

-- Helper: is the current user an admin?
create or replace function is_admin()
returns boolean as $$
  select exists(
    select 1 from admins where user_id = auth.uid()
  );
$$ language sql stable security definer;

-- Helper: is the current user a super admin?
create or replace function is_super_admin()
returns boolean as $$
  select exists(
    select 1 from admins where user_id = auth.uid() and role = 'super'
  );
$$ language sql stable security definer;

-- Public read policies (anon can see published events, all overlays and event types)
create policy "Public can read published events"
  on events for select
  using (status = 'published');

create policy "Public can read overlay calendars"
  on overlay_calendars for select
  using (true);

create policy "Public can read event types"
  on event_types for select
  using (true);

-- Public can create submissions (but not read them)
create policy "Public can create submissions"
  on submissions for insert
  with check (true);

-- Admin policies
create policy "Admins can do everything on events"
  on events for all using (is_admin()) with check (is_admin());

create policy "Admins can do everything on overlays"
  on overlay_calendars for all using (is_admin()) with check (is_admin());

create policy "Admins can do everything on event_types"
  on event_types for all using (is_admin()) with check (is_admin());

create policy "Admins can read all submissions"
  on submissions for select using (is_admin());

create policy "Admins can update submissions"
  on submissions for update using (is_admin()) with check (is_admin());

create policy "Admins can delete submissions"
  on submissions for delete using (is_admin());

create policy "Admins can access csv_imports"
  on csv_imports for all using (is_admin()) with check (is_admin());

create policy "Admins can read audit log"
  on audit_log for select using (is_admin());

create policy "Admins can insert audit log"
  on audit_log for insert with check (is_admin());

-- Super admin only: manage admins table
create policy "Admins can read admins list"
  on admins for select using (is_admin());

create policy "Super admins can manage admins"
  on admins for all using (is_super_admin()) with check (is_super_admin());

-- ============================================================
-- SEED DATA (idempotent)
-- ============================================================

insert into overlay_calendars (name, slug, color, default_visible, sort_order) values
  ('Movement Calendar',            'movement',       '#39375b', true,  1),
  ('Congressional Schedule',       'congressional',  '#e879a1', true,  2),
  ('Elections',                    'elections',      '#10b981', true,  3),
  ('Events, Meetings, Festivals',  'events-meetings','#06b6d4', true,  4),
  ('Holidays',                     'holidays',       '#ec4899', true,  5),
  ('Recurring Events',             'recurring',      '#a78bfa', true,  6),
  ('SCOTUS',                       'scotus',         '#1e40af', true,  7),
  ('Sports',                       'sports',         '#3b82f6', false, 8)
on conflict (slug) do nothing;

insert into event_types (name, slug, sort_order) values
  ('Action',                'action',        1),
  ('Arts & Culture',        'arts-culture',  2),
  ('Conferences & Summits', 'conferences',   3),
  ('Fundraiser',            'fundraiser',    4),
  ('Meeting',               'meeting',       5),
  ('Mutual Aid',            'mutual-aid',    6),
  ('Talks & Lectures',      'talks',         7),
  ('Training',              'training',      8)
on conflict (slug) do nothing;

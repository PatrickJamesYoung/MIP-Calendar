-- MIP Admin Wiki
--
-- A markdown-based internal knowledge base for MIP admins. Pages are addressed
-- by url-safe slug, edited in-app, and versioned on every save so history is
-- browsable. Full-text search is provided by a generated tsvector column with
-- a GIN index.
--
-- Design decisions:
--   * wiki_pages holds the current published body per page (fast reads, single
--     row per slug for /admin/wiki/[slug]).
--   * wiki_page_versions is append-only history. Every update to wiki_pages
--     writes a version row via trigger.
--   * FTS uses english config over title + body_md. Good enough for the ~dozens
--     of pages we expect; can be swapped for pg_trgm later without breaking
--     the API.
--   * RLS: admins can read and write both tables (aligned with the rest of the
--     admin portal). No public read.
--
-- Prefixed wiki_* to coexist with events, gear_*, submissions, etc. in the
-- shared Supabase project — same pattern used for gear.

create extension if not exists "uuid-ossp";

-- ============================================================
-- wiki_pages: current version of each page
-- ============================================================

create table if not exists wiki_pages (
  id uuid primary key default uuid_generate_v4(),
  slug text not null unique,
  title text not null,
  body_md text not null default '',
  summary text,                              -- optional short description for indexes
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Generated FTS column. Title weighted A, summary B, body C.
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body_md, '')), 'C')
  ) stored,
  constraint wiki_pages_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint wiki_pages_slug_len check (char_length(slug) between 1 and 80),
  constraint wiki_pages_title_len check (char_length(title) between 1 and 200)
);

create index if not exists wiki_pages_updated_at_idx
  on wiki_pages(updated_at desc);

create index if not exists wiki_pages_search_tsv_idx
  on wiki_pages using gin(search_tsv);

comment on table wiki_pages is
  'MIP Admin Wiki — one row per current page. History lives in wiki_page_versions.';

-- ============================================================
-- wiki_page_versions: append-only history
-- ============================================================

create table if not exists wiki_page_versions (
  id uuid primary key default uuid_generate_v4(),
  page_id uuid not null references wiki_pages(id) on delete cascade,
  version int not null,                      -- 1-based, monotonic per page
  title text not null,
  body_md text not null,
  summary text,
  edited_by uuid references auth.users(id) on delete set null,
  edited_by_email text,                      -- denormalized for quick history rendering
  edit_note text,                            -- optional commit message
  created_at timestamptz not null default now(),
  unique (page_id, version)
);

create index if not exists wiki_page_versions_page_id_idx
  on wiki_page_versions(page_id, version desc);

comment on table wiki_page_versions is
  'MIP Admin Wiki — append-only history of every page save. Latest version matches wiki_pages.';

-- ============================================================
-- Trigger: keep updated_at fresh and write a version row on every write.
-- ============================================================

create or replace function wiki_pages_write_version()
returns trigger as $$
declare
  next_version int;
  actor_email text;
begin
  -- Bump updated_at on UPDATE (unchanged on INSERT since default is now()).
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  -- Compute next version number.
  select coalesce(max(version), 0) + 1
    into next_version
    from wiki_page_versions
   where page_id = new.id;

  -- Best-effort lookup of the actor's email for cheap history rendering.
  select email into actor_email from admins where user_id = new.updated_by;

  insert into wiki_page_versions
    (page_id, version, title, body_md, summary, edited_by, edited_by_email)
  values
    (new.id, next_version, new.title, new.body_md, new.summary, new.updated_by, actor_email);

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists wiki_pages_write_version on wiki_pages;
create trigger wiki_pages_write_version
  after insert or update on wiki_pages
  for each row execute function wiki_pages_write_version();

-- ============================================================
-- RLS: admin-only (reuses is_admin() defined in 0001_initial_schema.sql).
-- ============================================================

alter table wiki_pages enable row level security;
alter table wiki_page_versions enable row level security;

drop policy if exists wiki_pages_admin_all on wiki_pages;
create policy wiki_pages_admin_all on wiki_pages
  for all using (is_admin()) with check (is_admin());

drop policy if exists wiki_page_versions_admin_read on wiki_page_versions;
create policy wiki_page_versions_admin_read on wiki_page_versions
  for select using (is_admin());

-- History is written exclusively by the trigger (security definer), so no
-- INSERT policy is needed for regular clients. Deletion is intentionally
-- disallowed — history is append-only.

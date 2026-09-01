-- 0105_email_messages_rls.sql
--
-- Enable Row Level Security on gear_email_messages and
-- spaces_email_messages without adding any policies.
--
-- Background:
--   Both tables are intentionally server-only. Every read and write in
--   the app goes through createAdminClient(), which uses the Supabase
--   service_role key and bypasses RLS. No anon or authenticated code
--   path touches these tables.
--
--   However, Supabase's security advisor flags any table in a schema
--   that PostgREST exposes (i.e. `public`) when RLS is off, because a
--   misconfigured client could otherwise query the table with the anon
--   key. Enabling RLS with zero policies is the canonical fix: the
--   service role continues to work unchanged, and anon/authenticated
--   requests get no rows and no writes.
--
--   This matches the intent captured in 0103's header comment ("no
--   RLS: this table is server-only, accessed through the service-role
--   admin client") and in 0104's line ("spaces_email_messages: no
--   RLS, server-only via service-role"). We keep the same access
--   model; we just make it enforceable at the DB level instead of
--   relying on callers to always pick the right client.

alter table public.gear_email_messages   enable row level security;
alter table public.spaces_email_messages enable row level security;

-- No policies are created on purpose. The service role bypasses RLS,
-- so all existing server code keeps working. Anon and authenticated
-- clients get zero rows on select and are rejected on write.

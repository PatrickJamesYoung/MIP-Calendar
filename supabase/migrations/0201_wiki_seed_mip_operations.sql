-- Seed the first wiki page: "MIP Operations".
--
-- Idempotent: uses INSERT ... ON CONFLICT (slug) DO NOTHING so re-running the
-- migration is a no-op and does not clobber whatever content the admins have
-- written by the time this runs a second time.
--
-- created_by / updated_by are left NULL — this row is authored by the system,
-- not by a specific admin user. The versioning trigger will still write a
-- wiki_page_versions v1 row (with edited_by_email NULL) so history remains
-- consistent.

insert into wiki_pages (slug, title, summary, body_md)
values (
  'mip-operations',
  'MIP Operations',
  'Landing page for how MIP runs day-to-day — meetings, tools, contacts, and how to get things done.',
  '# MIP Operations

Welcome to the MIP operations wiki. This is the starting point for how MIP runs day-to-day. Edit this page — and add new pages under the Wiki tab — to build up shared context that outlasts any single Slack thread or session.

## Suggested sections

- **Meetings & cadences** — recurring calls, standing agendas, note-taking conventions.
- **Tools & access** — canonical list of the systems MIP uses (Supabase, Vercel, Notion, Resend, Restream, etc.) and how to get access.
- **Contacts** — key people inside MIP and at partner orgs.
- **Runbooks** — step-by-step guides for things you do more than once (livestream setup, gear pickup, event day-of).
- **Decisions** — a rolling log of what MIP has decided and why.

> This page was auto-created when the wiki launched. Replace this text with real content.
'
)
on conflict (slug) do nothing;

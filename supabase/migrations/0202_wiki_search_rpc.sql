-- Full-text search RPC for the admin wiki.
--
-- Uses the generated search_tsv column (title A / summary B / body C, defined
-- in 0200_wiki_schema.sql) plus websearch_to_tsquery so admins can use
-- Google-style operators ("phrase", -exclude, OR) without learning tsquery
-- syntax.
--
-- Results include a ts_headline snippet from body_md for use in the wiki
-- index list. Returns at most 50 rows ordered by rank; empty/whitespace
-- queries return zero rows (the caller falls back to the plain "recent
-- pages" list).
--
-- security invoker so RLS on wiki_pages still applies — this is called from
-- the anon/authenticated context via PostgREST, not from service-role code.

create or replace function wiki_search(q text)
returns table (
  id uuid,
  slug text,
  title text,
  summary text,
  updated_at timestamptz,
  snippet text,
  rank real
)
language sql
stable
security invoker
set search_path = public
as $$
  with query as (
    select websearch_to_tsquery('english', coalesce(q, '')) as tsq
  )
  select
    p.id,
    p.slug,
    p.title,
    p.summary,
    p.updated_at,
    ts_headline(
      'english',
      p.body_md,
      (select tsq from query),
      'MaxWords=25, MinWords=10, ShortWord=3, HighlightAll=false, MaxFragments=2, FragmentDelimiter=" … "'
    ) as snippet,
    ts_rank_cd(p.search_tsv, (select tsq from query)) as rank
  from wiki_pages p, query
  where
    trim(coalesce(q, '')) <> ''
    and query.tsq <> ''::tsquery
    and p.search_tsv @@ query.tsq
  order by rank desc, p.updated_at desc
  limit 50;
$$;

comment on function wiki_search(text) is
  'MIP Admin Wiki — full-text search over wiki_pages.search_tsv. Returns id, slug, title, summary, updated_at, headline snippet, and rank. Uses websearch_to_tsquery so callers can pass Google-style queries.';

-- Grant execute to authenticated so the admin session can call it. Admins
-- are already RLS-gated on wiki_pages itself, and this function is
-- security invoker.
grant execute on function wiki_search(text) to authenticated;

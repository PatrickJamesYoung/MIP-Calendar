-- The wiki now stores HTML (from Tiptap) alongside legacy markdown rows.
-- When ts_headline runs against HTML, it produces fragments with broken tags
-- interleaved with its <b> highlight markers. Strip HTML before headlining
-- so search snippets are always plain text with <b> highlights only.
--
-- The tsvector column (search_tsv) is generated from body_md and still
-- indexes the raw content; that's fine because Postgres tokenizes HTML
-- entities and tags as separate tokens that never match user queries.

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
      -- Strip HTML tags before generating the snippet so we don't emit
      -- broken markup. regexp_replace with 'g' removes every <...> tag,
      -- then collapse runs of whitespace.
      regexp_replace(regexp_replace(p.body_md, '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g'),
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

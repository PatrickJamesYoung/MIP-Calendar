-- Pin wiki pages to the top of the index.
--
-- `pinned_at` doubles as the sort key for pinned pages so the most
-- recently pinned page shows first. Null means unpinned.
alter table wiki_pages
  add column if not exists pinned_at timestamptz;

-- Partial index — the index list only ever asks for pinned rows in the
-- pinned section, and pinned pages are the small minority.
create index if not exists wiki_pages_pinned_at_idx
  on wiki_pages (pinned_at desc)
  where pinned_at is not null;

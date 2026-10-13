-- 022 — Printed page numbers and a document's contents (decided 12 October
-- 2026: handoff §6 items 0 and 1).
--
--   - document_page_labels: the number printed on a PDF page, where it differs
--     from its place in the file ("812" on PDF page 824). Kept twice: as the
--     PDF's own page labels say (pdf_label, read from the file) and as set by
--     hand for a range of pages (hand_label: "from PDF page 13, the printed
--     number is 1"). The hand label wins; clearing it brings back the PDF's.
--     page_label() answers for one page. Pages with neither have no known
--     printed number; citations stay by PDF page either way.
--   - document_sections: the PDF's outline (its bookmarks), in order, each
--     with its level and the PDF page it starts on. Rebuilt from the file
--     whenever it is read again.
--
-- Both belong to their document: read with it, written by whoever may edit
-- it (document_rank 3 or more), and deleted with it.
--
-- Requires 004. Safe to run twice.

begin;

create table if not exists document_page_labels (
  document_id  bigint not null references documents(id) on delete cascade,
  page         int not null check (page > 0),
  pdf_label    text check (pdf_label is null or (pdf_label <> '' and char_length(pdf_label) <= 20)),
  hand_label   text check (hand_label is null or (hand_label <> '' and char_length(hand_label) <= 20)),
  primary key (document_id, page),
  check (pdf_label is not null or hand_label is not null)
);

create or replace function page_label(p_document bigint, p_page int) returns text
language sql stable as $body$
  select coalesce(hand_label, pdf_label) from document_page_labels where document_id = p_document and page = p_page
$body$;

create table if not exists document_sections (
  document_id  bigint not null references documents(id) on delete cascade,
  position     int not null check (position > 0),
  level        int not null check (level between 1 and 8),
  title        text not null check (title <> '' and char_length(title) <= 300),
  page         int not null check (page > 0),
  primary key (document_id, position)
);
create index if not exists document_sections_page_idx on document_sections (document_id, page);

alter table document_page_labels enable row level security;
alter table document_sections    enable row level security;

drop policy if exists document_page_labels_read on document_page_labels;
create policy document_page_labels_read on document_page_labels for select using (document_rank(document_id) > 0);
drop policy if exists document_page_labels_write on document_page_labels;
create policy document_page_labels_write on document_page_labels for all
  using (document_rank(document_id) >= 3 and not app_admin_viewing())
  with check (document_rank(document_id) >= 3 and not app_admin_viewing());

drop policy if exists document_sections_read on document_sections;
create policy document_sections_read on document_sections for select using (document_rank(document_id) > 0);
drop policy if exists document_sections_write on document_sections;
create policy document_sections_write on document_sections for all
  using (document_rank(document_id) >= 3 and not app_admin_viewing())
  with check (document_rank(document_id) >= 3 and not app_admin_viewing());

grant select, insert, update, delete on document_page_labels, document_sections to bottega_app;

-- Roman numerals, for front matter set by hand.
create or replace function to_roman(n int) returns text
language plpgsql immutable as $body$
declare
  vals int[] := array[1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  syms text[] := array['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
  out text := '';
  i int;
begin
  if n is null or n < 1 or n > 3999 then
    return null;
  end if;
  for i in 1 .. array_length(vals, 1) loop
    while n >= vals[i] loop
      out := out || syms[i];
      n := n - vals[i];
    end loop;
  end loop;
  return out;
end;
$body$;

-- Sets printed numbers by hand for PDF pages p_from..p_to: p_from shows
-- p_first, and each page after it one more, in arabic or roman numerals; or
-- clears them ('none'), which leaves the PDF's own where it has them.
-- Returns the pages changed.
create or replace function document_label_range(p_document bigint, p_from int, p_to int, p_first int, p_style text) returns int
language plpgsql security invoker set search_path = public, pg_temp as $body$
declare
  n int;
begin
  if document_rank(p_document) < 3 or app_admin_viewing() then
    raise exception 'setting printed page numbers needs edit access to the document';
  end if;
  if p_from < 1 or p_to < p_from or p_to - p_from > 5000 then
    raise exception 'give a range of pages, from the first to the last';
  end if;
  if p_style = 'none' then
    update document_page_labels set hand_label = null
     where document_id = p_document and page between p_from and p_to and hand_label is not null and pdf_label is not null;
    get diagnostics n = row_count;
    delete from document_page_labels
     where document_id = p_document and page between p_from and p_to and pdf_label is null;
    return n;
  end if;
  if p_style not in ('arabic', 'roman') or p_first is null or p_first < 1 then
    raise exception 'the printed numbers are arabic or roman, starting from 1 or more';
  end if;
  insert into document_page_labels (document_id, page, hand_label)
  select p_document, p, case when p_style = 'roman' then to_roman(p_first + (p - p_from)) else (p_first + (p - p_from))::text end
    from generate_series(p_from, p_to) as p
  on conflict (document_id, page) do update set hand_label = excluded.hand_label;
  get diagnostics n = row_count;
  return n;
end;
$body$;

grant execute on function document_label_range(bigint, int, int, int, text) to bottega_app;

commit;

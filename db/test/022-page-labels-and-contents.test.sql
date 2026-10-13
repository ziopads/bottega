-- Tests for db/022-page-labels-and-contents.sql: printed page numbers and a
-- document's contents, read and written with the document.
--
-- Run once against a fresh scratch database with 001–022 applied, never Neon.
--
--   psql -d bottega_test -f db/test/022-page-labels-and-contents.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('C', 'c@x', 'Chris', 'active', false)
on conflict (user_id) do nothing;
select set_config('app.actor', '', false);

create schema if not exists tst; grant usage on schema tst to bottega_app;
create or replace function tst.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.refused(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok: % (%)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % was allowed', what;
end $$;
create or replace function tst.d() returns bigint language sql security definer as $$ select id from documents where title = 'Bible' $$;
create or replace function tst.label(p int) returns text language sql security definer as $$
  select page_label(tst.d(), p) $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'J', false);
insert into documents (library, title, kind, r2_key, filename, bytes, sha256) values (false, 'Bible', 'book', 'private/J/b.pdf', 'b.pdf', 10, repeat('f', 64));

-- The PDF's own labels, then a hand range over part of them.
insert into document_page_labels (document_id, page, pdf_label) select tst.d(), p, p::text from generate_series(1, 20) p;
select tst.expect(document_label_range(tst.d(), 1, 12, 1, 'roman') = 12, 'a roman range for the front matter');
select tst.expect(document_label_range(tst.d(), 13, 30, 1, 'arabic') = 18, 'an arabic range from page 13');
select tst.expect(tst.label(4) = 'iv' and tst.label(13) = '1' and tst.label(30) = '18', 'labels follow the ranges');
select document_label_range(tst.d(), 13, 30, null, 'none');
select tst.expect(tst.label(13) = '13' and tst.label(25) is null, 'clearing a hand range brings back the PDF''s labels, and only those');
select tst.refused($$select document_label_range(tst.d(), 5, 2, 1, 'arabic')$$, 'a range that runs backwards');
select tst.refused($$select document_label_range(tst.d(), 1, 2, 1, 'greek')$$, 'an unknown style');

-- Contents.
insert into document_sections (document_id, position, level, title, page) values
  (tst.d(), 1, 1, 'Section A: Getting started', 3), (tst.d(), 2, 2, 'A01: The screen', 5);
select tst.expect((select count(*) = 2 from document_sections where document_id = tst.d()), 'the owner writes the contents');

-- Someone who cannot see the document sees neither, and cannot write.
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 0 from document_page_labels) and (select count(*) = 0 from document_sections),
  'nothing of a document one cannot read');
select tst.refused($$select document_label_range(tst.d(), 1, 2, 1, 'arabic')$$, 'setting labels without edit access');
insert into shares (document_id, grantee_id, level, granted_by) select tst.d(), 'C', 'view', 'J' where false;  -- (sharing is the owner's)
select set_config('app.user_id', 'J', false);
insert into shares (document_id, grantee_id, level, granted_by) values (tst.d(), 'C', 'view', 'J');
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 2 from document_sections), 'a reader of the document reads its contents');
select tst.refused($$insert into document_sections (document_id, position, level, title, page) values (tst.d(), 3, 1, 'x', 9)$$,
  'a viewer writing the contents');

reset role;
select 'all 022 tests passed' as result;

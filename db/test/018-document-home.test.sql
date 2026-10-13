-- Tests for db/018-document-home.sql: the administrator moves a document
-- between the library and private documents; nobody else can.
--
-- Run once against a fresh scratch database with 001–018 applied, never Neon.
--
--   psql -d bottega_test -f db/test/018-document-home.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('C', 'c@x', 'Chris', 'active', false), ('G', 'g@x', 'Gordon', 'active', false)
on conflict (user_id) do nothing;
insert into gear_models (kind, category, manufacturer, model, status) values ('hardware', 'sampler', 'Akai', 'MPC One', 'approved')
on conflict do nothing;
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
create or replace function tst.pages(t text) returns bigint language sql security definer as $$
  select count(*) from pages where document_id = (select id from documents where title = t) $$;
create or replace function tst.doc(t text) returns documents language sql security definer as $$ select * from documents where title = t $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- Chris puts a book in the library by mistake; Gordon picks it; it is linked to a model.
select set_config('app.user_id', 'C', false);
insert into documents (library, title, kind, r2_key, filename, bytes, sha256) values (true, 'A book', 'manual', 'library/a.pdf', 'a.pdf', 10, repeat('a', 64));
insert into pages (document_id, page_number, text) values ((tst.doc('A book')).id, 1, 'page one');
select set_config('app.user_id', 'J', false);
update documents set review_status = 'approved' where title = 'A book';
insert into model_documents (model_id, document_id) values ((select id from gear_models where model = 'MPC One'), (tst.doc('A book')).id);
select set_config('app.user_id', 'G', false);
insert into library_picks (document_id) values ((tst.doc('A book')).id);

-- Nobody but the administrator moves it.
select set_config('app.user_id', 'C', false);
select tst.refused($$select document_set_home((tst.doc('A book')).id, false, 'book')$$, 'the contributor moving a document');
select set_config('app.document_home', 'on', false);
select tst.refused($$update documents set library = false where title = 'A book'$$, 'a direct update with the setting forged');
select set_config('app.document_home', '', false);

-- Library to private.
select set_config('app.user_id', 'J', false);
select tst.refused($$select document_set_home((tst.doc('A book')).id, true, null)$$, 'moving it where it already is');
select document_set_home((tst.doc('A book')).id, false, 'book');
select tst.expect(((tst.doc('A book')).library, (tst.doc('A book')).owner_id, (tst.doc('A book')).kind) = (false, 'C', 'book'),
  'library to private: its contributor''s, with the kind given');
select tst.expect((select count(*) = 0 from model_documents where document_id = (tst.doc('A book')).id), 'its model links are removed');
select tst.expect((select count(*) from library_picks where document_id = (tst.doc('A book')).id) = 0, 'other accounts'' picks are removed');
select tst.expect(tst.pages('A book') = 1, 'its pages are kept');
select set_config('app.user_id', 'G', false);
select tst.expect(document_rank((tst.doc('A book')).id) = 0, 'Gordon no longer reads it');
select set_config('app.user_id', 'C', false);
select tst.expect(document_level((tst.doc('A book')).id) = 'owner', 'Chris owns it');

-- Private to library: shares go, the former owner stays as contributor.
insert into shares (document_id, grantee_id, level, granted_by) values ((tst.doc('A book')).id, 'G', 'view', 'C');
select set_config('app.user_id', 'J', false);
select tst.refused($$select document_set_home((tst.doc('A book')).id, true, 'book')$$, 'a book into the library');
select document_set_home((tst.doc('A book')).id, true, 'manual');
select tst.expect(((tst.doc('A book')).library, (tst.doc('A book')).owner_id, (tst.doc('A book')).contributed_by, (tst.doc('A book')).review_status)
  is not distinct from (true, null::text, 'C'::text, 'approved'::text), 'private to library: approved, contributed by its former owner');
select tst.expect((select count(*) = 0 from shares where document_id = (tst.doc('A book')).id), 'its shares are removed');
select set_config('app.user_id', 'G', false);
select tst.expect(document_level((tst.doc('A book')).id) = 'view', 'every account reads it');

-- The same file twice.
select set_config('app.user_id', 'C', false);
insert into documents (library, title, kind, r2_key, filename, bytes, sha256) values (false, 'Twin', 'book', 'private/C/t.pdf', 't.pdf', 10, repeat('a', 64));
select set_config('app.user_id', 'J', false);
select tst.refused($$select document_set_home((tst.doc('Twin')).id, true, 'manual')$$, 'a second library copy of a file');
select tst.refused($$select document_set_home((tst.doc('A book')).id, false, 'book')$$, 'a second private copy for the same account');

select tst.expect((select count(*) = 2 from access_log where action = 'document_moved'), 'every move is logged');
reset role;
select 'all 018 tests passed' as result;

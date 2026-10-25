-- Tests for db/004-corpus.sql: library review and dedupe, private documents
-- and their shares, the administrator's read-only view, the allowances
-- (claim_pages, the platform ceiling, storage), and the usage ledger.
--
-- Run once against a fresh scratch database with 001–004 applied, never Neon. Without
-- pgvector, apply 004 with halfvec(1024) replaced by real[] and the HNSW
-- index removed; nothing here touches embeddings.
--
--   psql -d bottega_test -f db/test/004-corpus.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'Person A', 'active', true), ('C', 'c@x', 'Person B', 'active', false),
  ('G', 'g@x', 'Person C', 'active', false), ('P', 'p@x', 'Pending', 'pending', false)
on conflict (user_id) do nothing;
insert into gear_models (kind, category, manufacturer, model, status)
  select 'hardware', 'synthesizer', 'Moog', 'Matriarch', 'approved'
  where not exists (select 1 from gear_models where model = 'Matriarch');
select set_config('app.actor', '', false);

create schema if not exists tst; grant usage on schema tst to bottega_app;
create or replace function tst.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
-- A statement that must be refused with an error.
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
-- A statement that must touch exactly n rows (RLS refuses updates silently).
create or replace function tst.affects(stmt text, n int, what text) returns void language plpgsql as $$
declare got int;
begin
  execute stmt;
  get diagnostics got = row_count;
  if got <> n then raise exception 'FAILED: % (touched %, expected %)', what, got, n; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.doc(t text) returns bigint language sql security definer as $$ select id from documents where title = t $$;
create or replace function tst.first_usage(a text) returns bigint language sql security definer as $$ select min(id) from processing_usage where account_id = a $$;
create or replace function tst.sha(c text) returns text language sql as $$ select repeat(c, 64) $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- Library submissions -------------------------------------------------------------------
select set_config('app.user_id', 'C', false);
insert into documents (library, review_status, owner_id, title, manufacturer, model, r2_key, filename, bytes, sha256)
  values (true, 'approved', 'C', 'Matriarch Manual', 'Moog', 'Matriarch', 'library/1/a.pdf', 'm.pdf', 1000, tst.sha('a'));
reset role;
select tst.expect((select review_status = 'submitted' and contributed_by = 'C' and owner_id is null
                   from documents where title = 'Matriarch Manual'),
  'a contributor''s library upload arrives submitted, contributed by them, owned by nobody');
set role bottega_app;
select tst.expect(document_level(tst.doc('Matriarch Manual')) = 'edit', 'the contributor edits their submission');
select tst.affects($$update documents set title = 'Matriarch Manual' , manufacturer = 'Moog Music' where title = 'Matriarch Manual'$$, 1,
  'the contributor corrects their submission');
select tst.refused($$update documents set review_status = 'approved' where title = 'Matriarch Manual'$$,
  'a contributor approving their own submission');
select tst.refused($$update documents set sha256 = tst.sha('b') where title = 'Matriarch Manual'$$,
  'changing a document''s file');

select set_config('app.user_id', 'G', false);
select tst.expect(not exists (select 1 from documents where title = 'Matriarch Manual'),
  'another account cannot see a submission under review');
select tst.expect((select review_status from find_library_document(upper(tst.sha('a')))) = 'submitted',
  'find_library_document answers by fingerprint, in any case');
select tst.refused($$insert into documents (library, title, r2_key, filename, bytes, sha256)
                     values (true, 'Matriarch Copy', 'library/2/b.pdf', 'm.pdf', 1000, tst.sha('a'))$$,
  'a second library copy of the same file');
select tst.refused($$select * from claim_pages(tst.doc('Matriarch Manual'), 10)$$,
  'claiming pages on someone else''s submission');

-- Processing a submission spends the contributor's allowance ---------------------------
select set_config('app.user_id', 'C', false);
select tst.expect((select granted from claim_pages(tst.doc('Matriarch Manual'), 40)) = 40,
  'the contributor claims 40 pages');
insert into pages (document_id, page_number, text) values (tst.doc('Matriarch Manual'), 1, 'Patch the VCO to the filter.');
insert into chunks (document_id, first_page, last_page, text) values (tst.doc('Matriarch Manual'), 1, 1, 'Patch the VCO to the filter.');
select set_config('app.user_id', 'G', false);
select tst.expect(not exists (select 1 from pages where text like 'Patch%'), 'another account cannot read pages under review');
select tst.refused($$insert into pages (document_id, page_number, text) values (tst.doc('Matriarch Manual'), 2, 'x')$$,
  'writing pages into someone else''s submission');

-- Review --------------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
select tst.affects($$update documents set review_status = 'approved' where title = 'Matriarch Manual'$$, 1,
  'the administrator approves');
reset role;
select tst.expect((select approved_at is not null from documents where title = 'Matriarch Manual'), 'approval is dated');
select tst.expect(exists (select 1 from access_log where action = 'document_reviewed' and subject_id = 'C'),
  'the review is in the access log');
set role bottega_app;
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) from chunks where text like 'Patch%') = 1, 'once approved, everyone reads it');
select tst.expect(document_level(tst.doc('Matriarch Manual')) = 'view', 'and only reads it');
select tst.affects($$update documents set title = 'Vandal' where title = 'Matriarch Manual'$$, 0,
  'a reader cannot retitle a library document');
insert into model_documents (model_id, document_id) select id, tst.doc('Matriarch Manual') from gear_models where model = 'Matriarch';
insert into library_picks (document_id) values (tst.doc('Matriarch Manual'));
select tst.expect((select count(*) from library_picks) = 1, 'a pick is the picker''s own');
select set_config('app.user_id', 'C', false);
select tst.expect(document_level(tst.doc('Matriarch Manual')) = 'view', 'after approval the contributor only reads it too');
select tst.expect((select count(*) from library_picks) = 0, 'nobody sees another''s picks');
select tst.affects($$delete from documents where title = 'Matriarch Manual'$$, 0,
  'a contributor cannot withdraw an approved document');
select tst.affects($$delete from model_documents$$, 0, 'nor remove a link someone else made');

-- Rejection and withdrawal --------------------------------------------------------------
insert into documents (library, title, r2_key, filename, bytes, sha256)
  values (true, 'Bad Scan', 'library/3/c.pdf', 'c.pdf', 500, tst.sha('c')),
         (true, 'Second Thoughts', 'library/4/d.pdf', 'd.pdf', 500, tst.sha('d'));
insert into pages (document_id, page_number, text) values (tst.doc('Bad Scan'), 1, 'blurry');
select set_config('app.user_id', 'J', false);
update documents set review_status = 'rejected' where title = 'Bad Scan';
select set_config('app.user_id', 'C', false);
select tst.expect(document_level(tst.doc('Bad Scan')) = 'view', 'a rejected submission stays readable by its contributor');
select tst.affects($$update documents set title = 'Better Scan' where title = 'Bad Scan'$$, 0, 'but not editable');
select tst.affects($$delete from documents where title = 'Bad Scan'$$, 1, 'the contributor deletes a rejected submission');
select tst.affects($$delete from documents where title = 'Second Thoughts'$$, 1, 'and withdraws one under review');
reset role;
select tst.expect(not exists (select 1 from pages where text = 'blurry'), 'its pages go with it');
set role bottega_app;

-- Private documents and their shares ----------------------------------------------------
select set_config('app.user_id', 'G', false);
insert into documents (library, owner_id, review_status, kind, title, r2_key, filename, bytes, sha256)
  values (false, 'C', 'submitted', 'book', 'Person C''s Book', 'a/G/document/1/e.pdf', 'e.pdf', 2000, tst.sha('e'));
reset role;
select tst.expect((select owner_id = 'G' and review_status = 'approved' from documents where title = 'Person C''s Book'),
  'a private upload belongs to its uploader, whatever the request said');
set role bottega_app;
insert into pages (document_id, page_number, text) values (tst.doc('Person C''s Book'), 1, 'Chapter one.');
select tst.expect((select granted from claim_pages(tst.doc('Person C''s Book'), 1)) = 1, 'the owner processes a private document');
select set_config('app.user_id', 'C', false);
select tst.expect(not exists (select 1 from documents where title = 'Person C''s Book'), 'by default nobody else sees it');
select tst.refused($$insert into shares (document_id, grantee_id, level, granted_by)
                     values (tst.doc('Person C''s Book'), 'C', 'edit', 'C')$$, 'sharing someone else''s document with oneself');
select set_config('app.user_id', 'G', false);
insert into shares (document_id, grantee_id, level, granted_by) values (tst.doc('Person C''s Book'), 'C', 'view', 'G');
select tst.refused($$insert into shares (document_id, grantee_id, level, granted_by)
                     values (tst.doc('Matriarch Manual'), 'C', 'view', 'G')$$, 'sharing a library document');
select tst.refused($$insert into shares (document_id, grantee_id, level, granted_by)
                     values (tst.doc('Person C''s Book'), 'P', 'view', 'G')$$, 'sharing with a pending account');
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) from pages where text = 'Chapter one.') = 1, 'a view share reads the pages');
select tst.affects($$update documents set title = 'Mine Now' where title = 'Person C''s Book'$$, 0, 'and cannot edit');
reset role;
select tst.expect(exists (select 1 from access_log where action = 'share_granted' and item_kind = 'document'),
  'document shares are in the access log');
set role bottega_app;

-- The administrator's read-only view ----------------------------------------------------
select set_config('app.user_id', 'J', false);
select tst.expect(not exists (select 1 from documents where title = 'Person C''s Book'),
  'the administrator does not see private documents by default');
select set_config('app.admin_view', 'on', false);
select tst.expect(document_level(tst.doc('Person C''s Book')) = 'view', 'the admin view reads them');
select tst.affects($$update documents set title = 'Edited' where title = 'Person C''s Book'$$, 0, 'and cannot edit');
select tst.affects($$delete from documents where title = 'Person C''s Book'$$, 0, 'nor delete');
select set_config('app.admin_view', '', false);

-- Allowances ----------------------------------------------------------------------------
select set_config('app.user_id', 'C', false);
select tst.refused($$insert into account_limits (user_id, pages_per_month) values ('C', 100000)$$, 'raising one''s own allowance');
select set_config('app.user_id', 'J', false);
insert into account_limits (user_id, pages_per_month) values ('C', 50);
reset role;
select tst.expect(exists (select 1 from access_log where action = 'limits_changed' and subject_id = 'C'),
  'allowance changes are in the access log');
set role bottega_app;
select set_config('app.user_id', 'C', false);
insert into documents (library, title, r2_key, filename, bytes, sha256)
  values (false, 'Person B Notes', 'a/C/document/2/f.pdf', 'f.pdf', 3000, tst.sha('f'));
select tst.expect((select pages_per_month = 50 and pages_used = 40 from my_allowance()), 'my_allowance shows the override and the use');
select tst.expect((select granted from claim_pages(tst.doc('Person B Notes'), 40)) = 10, 'a claim past the allowance gets what is left');
select tst.expect((select granted from claim_pages(tst.doc('Person B Notes'), 40)) = 0, 'then nothing');
select tst.expect((select storage_used from my_allowance()) = 3000,
  'storage counts private documents and not approved library contributions');

select set_config('app.user_id', 'J', false);
update platform_settings set value = jsonb_set(value, '{platform_pages_per_month}', to_jsonb(platform_pages_this_month() + 5))
  where key = 'limits';
set role bottega_app;
select set_config('app.user_id', 'J', false);
select tst.expect((select pages_per_month is null and platform_pages_left = 5 from my_allowance()),
  'the administrator has no allowance, only the platform ceiling');
select tst.expect((select granted from claim_pages(tst.doc('Matriarch Manual'), 40)) = 5,
  'the platform ceiling stops the administrator too');
select set_config('app.user_id', 'G', false);
select tst.expect((select granted from claim_pages(tst.doc('Person C''s Book'), 10)) = 0, 'and everyone else');
select set_config('app.user_id', 'J', false);
update platform_settings set value = jsonb_set(value, '{platform_pages_per_month}', '30000') where key = 'limits';
reset role;
select tst.expect(exists (select 1 from access_log where action = 'setting_changed'), 'setting changes are in the access log');
set role bottega_app;

-- The usage ledger ----------------------------------------------------------------------
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) from processing_usage) = 3, 'an account sees its own usage only');
select tst.refused($$update processing_usage set pages = 0$$, 'rewriting usage');
select record_tokens((select max(id) from processing_usage), 1234);
select tst.expect((select tokens from processing_usage order by id desc limit 1) = 1234, 'record_tokens on one''s own claim');
select record_tokens(tst.first_usage('G'), 99);
reset role;
select tst.expect((select tokens from processing_usage where account_id = 'G' order by id limit 1) = 0,
  'record_tokens ignores another account''s claim id');
select tst.refused($$delete from processing_usage$$, 'deleting usage, even as the owner role');
set role bottega_app;
select set_config('app.user_id', 'G', false);
select tst.affects($$delete from documents where title = 'Person C''s Book'$$, 1, 'the owner deletes a processed document');
reset role;
select tst.expect((select count(*) from processing_usage where account_id = 'G' and document_id is null) = 2,
  'its usage stays in the ledger');
set role bottega_app;

-- Accounts that are not active ----------------------------------------------------------
select set_config('app.user_id', 'P', false);
select tst.expect(not exists (select 1 from documents), 'a pending account sees no documents');
select tst.expect(not exists (select 1 from my_allowance()), 'and has no allowance');
select tst.refused($$insert into documents (library, title, r2_key, filename, bytes, sha256)
                     values (true, 'Spam', 'library/9/z.pdf', 'z.pdf', 1, tst.sha('9'))$$, 'a pending account uploading');

reset role;
select set_config('app.user_id', '', false);
\echo 004 corpus tests passed

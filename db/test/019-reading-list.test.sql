-- Tests for db/019-reading-list.sql: a study group's reading list takes
-- library manuals (the custodian's to list) beside private documents (their
-- owner's to share), and document_set_home keeps or removes listings.
--
-- Run once against a fresh scratch database with 001–019 applied, never Neon.
--
--   psql -d bottega_test -f db/test/019-reading-list.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'Person A', 'active', true), ('C', 'c@x', 'Person B', 'active', false), ('G', 'g@x', 'Person C', 'active', false)
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
create or replace function tst.affects(stmt text, n int, what text) returns void language plpgsql as $$
declare got int;
begin
  execute stmt; get diagnostics got = row_count;
  if got <> n then raise exception 'FAILED: % (changed %, expected %)', what, got, n; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.d(t text) returns bigint language sql security definer as $$ select id from documents where title = t $$;
create or replace function tst.g() returns bigint language sql security definer as $$ select id from study_groups where name = 'MPC study' $$;
create or replace function tst.listed(t text) returns boolean language sql security definer as $$
  select exists (select 1 from study_group_documents where group_id = tst.g() and document_id = tst.d(t)) $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- Person A's group, with Person B; an approved manual, a submitted one, Person B's book.
select set_config('app.user_id', 'J', false);
insert into study_groups (name) values ('MPC study');
select study_group_invite(tst.g(), 'c@x');
insert into documents (library, review_status, title, kind, r2_key, filename, bytes, sha256)
  values (true, 'approved', 'MPC One manual', 'manual', 'library/m.pdf', 'm.pdf', 10, repeat('c', 64));
select set_config('app.user_id', 'C', false);
select study_invitation_answer((select id from study_group_invitations where account_id = 'C'), true);
insert into documents (library, title, kind, r2_key, filename, bytes, sha256) values (true, 'Pending manual', 'manual', 'library/p.pdf', 'p.pdf', 10, repeat('d', 64));
insert into documents (library, title, kind, r2_key, filename, bytes, sha256) values (false, 'Person B book', 'book', 'private/C/b.pdf', 'b.pdf', 10, repeat('e', 64));

-- Library manuals: the custodian lists them.
select tst.refused($$insert into study_group_documents (group_id, document_id) values (tst.g(), tst.d('MPC One manual'))$$,
  'a member listing a library manual');
select set_config('app.user_id', 'J', false);
insert into study_group_documents (group_id, document_id) values (tst.g(), tst.d('MPC One manual'));
select tst.expect(tst.listed('MPC One manual'), 'the custodian lists a library manual');
select tst.refused($$insert into study_group_documents (group_id, document_id) values (tst.g(), tst.d('Pending manual'))$$,
  'listing a manual not yet approved');
select tst.refused($$insert into study_group_documents (group_id, document_id) values (tst.g(), tst.d('Person B book'))$$,
  'the custodian listing a member''s private document');

-- Private documents: their owner shares them.
select set_config('app.user_id', 'C', false);
insert into study_group_documents (group_id, document_id) values (tst.g(), tst.d('Person B book'));
select tst.affects($$delete from study_group_documents where document_id = tst.d('MPC One manual')$$, 0, 'a member unlisting a manual');
select set_config('app.user_id', 'G', false);
select tst.expect(document_rank(tst.d('Person B book')) = 0, 'outside the group, the book stays private');
select set_config('app.user_id', 'J', false);
select tst.expect(document_level(tst.d('Person B book')) = 'view', 'members read a shared book');
select tst.expect((select count(*) = 2 from study_group_documents), 'members see the whole reading list');

-- Moving homes.
select document_set_home(tst.d('Person B book'), true, 'manual');
select tst.expect(tst.listed('Person B book'), 'a document moved into the library stays on the list');
select document_set_home(tst.d('MPC One manual'), false, 'book');
select tst.expect(not tst.listed('MPC One manual'), 'a document moved out of the library leaves the list');
select tst.affects($$delete from study_group_documents where document_id = tst.d('Person B book')$$, 1, 'the custodian unlists a manual');

select tst.expect((select count(*) = 1 from access_log where action = 'document_listed_for_group'), 'listing is logged');
select tst.expect((select count(*) = 2 from access_log where action = 'document_unlisted_for_group'), 'unlisting is logged, by hand and by a move out of the library');
select tst.expect((select count(*) = 1 from access_log where action = 'document_shared_with_group'), 'sharing a private document is logged');

reset role;
select 'all 019 tests passed' as result;

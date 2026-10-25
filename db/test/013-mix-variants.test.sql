-- Tests for db/013-mix-variants.sql: versions numbered within a variant.
--
-- Run once against a fresh scratch database with 001–013 applied, never Neon.
--
--   psql -d bottega_test -f db/test/013-mix-variants.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'Person A', 'active', true), ('C', 'c@x', 'Person B', 'active', false)
on conflict (user_id) do nothing;
insert into projects (kind, title, created_by, owner_id) values ('music', 'khione', 'j@x', 'J');
insert into shares (project_id, grantee_id, level, granted_by) select id, 'C', 'contribute', 'J' from projects where title = 'khione';
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
create or replace function tst.p() returns bigint language sql security definer as $$ select id from projects where title = 'khione' $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'C', false);
insert into audio (project_id, role, version, r2_key, original_filename, uploaded_by)
  values (tst.p(), 'mix', 1, 'm1', 'khione.mp3', 'c@x');
insert into audio (project_id, role, version, variant, r2_key, original_filename, uploaded_by)
  values (tst.p(), 'mix', 1, 'Radio edit', 'r1', 'khione radio.mp3', 'c@x');
select tst.expect((select count(*) = 2 from audio where version = 1), 'v1 of the main mix and Radio edit v1 side by side');
select tst.refused(format($$insert into audio (project_id, role, version, variant, r2_key, original_filename, uploaded_by)
                          values (%s, 'mix', 1, 'Radio edit', 'r1b', 'x.mp3', 'c@x')$$, tst.p()), 'a second Radio edit v1');
select tst.refused(format($$insert into audio (project_id, role, version, variant, r2_key, original_filename, uploaded_by)
                          values (%s, 'mix', 2, 'Main', 'm2', 'x.mp3', 'c@x')$$, tst.p()), '"Main" spelled out (the main mix is the empty variant)');
select tst.refused(format($$insert into audio (project_id, role, variant, r2_key, original_filename, uploaded_by)
                          values (%s, 'reference', 'Extended', 'ref1', 'x.mp3', 'c@x')$$, tst.p()), 'a reference with a variant');
select tst.refused(format($$insert into audio (project_id, role, version, variant, r2_key, original_filename, uploaded_by)
                          values (%s, 'mix', 2, ' Radio edit ', 'm3', 'x.mp3', 'c@x')$$, tst.p()), 'an untrimmed variant');

reset role;
select 'all 013 tests passed' as result;

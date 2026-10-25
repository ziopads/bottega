-- Tests for db/015-session-variants.sql: variants as a list on the session,
-- saves sorted into them by name rule or by hand, renaming and removing.
--
-- Run once against a fresh scratch database with 001–015 applied, never Neon.
--
--   psql -d bottega_test -f db/test/015-session-variants.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'Person A', 'active', true), ('C', 'c@x', 'Person B', 'active', false), ('G', 'g@x', 'Person C', 'active', false)
on conflict (user_id) do nothing;
insert into projects (kind, title, created_by, owner_id) values ('music', 'khione', 'j@x', 'J');
insert into shares (project_id, grantee_id, level, granted_by) select id, 'C', 'edit', 'J' from projects where title = 'khione';
insert into shares (project_id, grantee_id, level, granted_by) select id, 'G', 'contribute', 'J' from projects where title = 'khione';
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
create or replace function tst.save(f text) returns bigint language sql security definer as $$
  insert into als_snapshots (project_id, file_name, saved_at, sha256, bytes, parser_version, data, created_by)
  values (tst.p(), f, now(), encode(sha256(convert_to(f, 'UTF8')), 'hex'), 100, 1, '{"tracks":[],"samples":[]}', 'C')
  returning id $$;
create or replace function tst.v(f text) returns text language sql security definer as $$
  select variant from als_snapshots where file_name = f $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- Person B has edit access.
select set_config('app.user_id', 'C', false);
select tst.save('khione 0.19.als');
select tst.save('khione 0.20 radio edit.als');
select tst.save('khione 0.21 RADIO EDIT ext.als');
select tst.expect(tst.v('khione 0.20 radio edit.als') = '', 'with no variants every save is the main mix');

insert into session_variants (project_id, name, match) values (tst.p(), 'Radio edit', 'radio edit');
select tst.expect(tst.v('khione 0.20 radio edit.als') = 'Radio edit', 'adding a variant sorts the saves already read');
select tst.expect(tst.v('khione 0.21 RADIO EDIT ext.als') = 'Radio edit', 'name rules ignore case');
select tst.expect(tst.v('khione 0.19.als') = '', 'a save no rule finds stays in the main mix');

insert into session_variants (project_id, name, match) values (tst.p(), 'Radio edit extended', 'radio edit ext');
select tst.expect(tst.v('khione 0.21 RADIO EDIT ext.als') = 'Radio edit extended', 'the longest rule found wins');
select tst.expect(tst.v('khione 0.20 radio edit.als') = 'Radio edit', 'shorter rule still holds where the longer is absent');

select tst.save('khione 0.22 radio edit.als');
select tst.expect(tst.v('khione 0.22 radio edit.als') = 'Radio edit', 'a new save is sorted as it is stored');

select tst.refused(format($$insert into session_variants (project_id, name, match) values (%s, 'radio EDIT', 'x')$$, tst.p()),
                   'a second variant differing only in case');
select tst.refused(format($$insert into session_variants (project_id, name, match) values (%s, 'Main', 'main')$$, tst.p()),
                   'a variant called Main');

-- By hand.
update als_snapshots set variant = 'radio edit', variant_by_hand = true where file_name = 'khione 0.19.als';
select tst.expect(tst.v('khione 0.19.als') = 'Radio edit', 'a save moved by hand, written in the variant''s spelling');
select tst.refused($$update als_snapshots set variant = 'Dub', variant_by_hand = true where file_name = 'khione 0.22 radio edit.als'$$,
                   'a save moved to a variant the session lacks');
update als_snapshots set variant_by_hand = false where file_name = 'khione 0.19.als';
select tst.expect(tst.v('khione 0.19.als') = '', 'handing a save back to the name rules');
update als_snapshots set variant = 'Radio edit', variant_by_hand = true where file_name = 'khione 0.19.als';

-- Mixes.
insert into audio (project_id, role, version, variant, r2_key, original_filename, uploaded_by)
  values (tst.p(), 'mix', 1, 'radio edit', 'r1', 'khione radio.mp3', 'c@x');
select tst.expect((select variant from audio where r2_key = 'r1') = 'Radio edit', 'a mix''s variant written in the variant''s spelling');
select tst.refused(format($$insert into audio (project_id, role, version, variant, r2_key, original_filename, uploaded_by)
                          values (%s, 'mix', 1, 'Dub', 'd1', 'x.mp3', 'c@x')$$, tst.p()), 'a mix in a variant the session lacks');

-- Renaming.
select rename_session_variant((select id from session_variants where name = 'Radio edit'), 'Radio', 'radio');
select tst.expect((select variant from audio where r2_key = 'r1') = 'Radio', 'renaming carries the variant''s mixes');
select tst.expect(tst.v('khione 0.19.als') = 'Radio', 'renaming carries the saves moved by hand');
select tst.expect(tst.v('khione 0.20 radio edit.als') = 'Radio', 'renaming sorts by the new rule');

-- Person C contributes: he may upload to a variant, not make or rename one.
select set_config('app.user_id', 'G', false);
insert into audio (project_id, role, version, variant, r2_key, original_filename, uploaded_by)
  values (tst.p(), 'mix', 2, 'Radio', 'r2', 'khione radio 2.mp3', 'g@x');
select tst.refused(format($$insert into session_variants (project_id, name, match) values (%s, 'Dub', 'dub')$$, tst.p()),
                   'a contributor making a variant');
select tst.refused($$select rename_session_variant((select id from session_variants where name = 'Radio'), 'Dub', 'dub')$$,
                   'a contributor renaming a variant');
update als_snapshots set variant_by_hand = false;  -- row-level security leaves him no rows to change
select tst.expect(tst.v('khione 0.19.als') = 'Radio', 'a contributor cannot move saves');

-- Removing: the owner only, and only an empty variant.
select set_config('app.user_id', 'C', false);
select tst.refused($$select delete_session_variant((select id from session_variants where name = 'Radio edit extended'))$$,
                   'an editor removing a variant');
select set_config('app.user_id', 'J', false);
select tst.refused($$select delete_session_variant((select id from session_variants where name = 'Radio'))$$,
                   'removing a variant that has mixes');
select delete_session_variant((select id from session_variants where name = 'Radio edit extended'));
select tst.expect(tst.v('khione 0.21 RADIO EDIT ext.als') = 'Radio', 'removing a variant sorts its saves by the rules left');
delete from audio where variant = 'Radio';
select delete_session_variant((select id from session_variants where name = 'Radio'));
select tst.expect(tst.v('khione 0.19.als') = '', 'a save moved by hand into a removed variant returns to the main mix');
select tst.expect((select count(*) = 0 from als_snapshots where variant <> ''), 'no variants left, every save in the main mix');

reset role;
select 'all 015 tests passed' as result;

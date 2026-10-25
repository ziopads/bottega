-- Tests for db/014-session-snapshots.sql: who stores and reads snapshots,
-- the columns and plugin rows derived from data, re-reading by a newer
-- parser, and the folder listing.
--
-- Run once against a fresh scratch database with 001–014 applied, never Neon.
--
--   psql -d bottega_test -f db/test/014-session-snapshots.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'Person A', 'active', true), ('E', 'e@x', 'Person D', 'active', false),
  ('C', 'c@x', 'Person B', 'active', false), ('O', 'o@x', 'Other', 'active', false)
on conflict (user_id) do nothing;
insert into projects (kind, title, created_by, owner_id) values ('music', 'khione', 'j@x', 'J');
insert into shares (project_id, grantee_id, level, granted_by) select id, 'E', 'edit', 'J' from projects where title = 'khione';
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
create or replace function tst.affects(stmt text, n int, what text) returns void language plpgsql as $$
declare got int;
begin
  execute stmt;
  get diagnostics got = row_count;
  if got <> n then raise exception 'FAILED: % (touched %, expected %)', what, got, n; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.p() returns bigint language sql security definer as $$ select id from projects where title = 'khione' $$;
create or replace function tst.set(v int) returns jsonb language sql immutable as $$
  select jsonb_build_object('parserVersion', v, 'live', 'Ableton Live 12.2.6', 'tempo', 102, 'lengthBeats', 512,
    'locators', '[]'::jsonb, 'samples', '[{"where":"external","path":"/x.wav"},{"where":"project","relativePath":"Samples/a.wav"}]'::jsonb,
    'tracks', '[{"id":"1","kind":"audio","devices":[{"name":"AIR Delay Pro","kind":"plugin","format":"vst3","on":true},
                                                     {"name":"AIR Delay Pro","kind":"plugin","format":"vst3","on":false},
                                                     {"name":"EQ Eight","kind":"native","on":true}]},
                {"id":"2","kind":"midi","devices":[{"name":"EchoBoy","kind":"plugin","format":"vst","on":true}]}]'::jsonb)
$$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'C', false);
select tst.refused(format($$insert into als_snapshots (project_id, file_name, saved_at, sha256, bytes, parser_version, data)
                          values (%s, 'k.als', now(), repeat('a', 64), 100, 1, tst.set(1))$$, tst.p()), 'a contributor cannot store a snapshot');
select set_config('app.user_id', 'E', false);
select tst.affects(format($$insert into als_snapshots (project_id, file_name, saved_at, sha256, bytes, parser_version, data)
                          values (%s, 'khione 0.19.als', now(), repeat('a', 64), 100, 1, tst.set(1))$$, tst.p()), 1, 'an editor stores a snapshot');
select tst.expect((select tempo = 102 and length_beats = 512 and tracks = 2 and plugins = 3 and external_samples = 1
                     and live_version = 'Ableton Live 12.2.6' from als_snapshots), 'summary columns follow data');
select tst.expect((select instances = 2 and active = 1 from als_plugins where name = 'AIR Delay Pro'), 'plugin instances, two with one off');
select tst.expect((select count(*) = 2 from als_plugins), 'one row per plugin');
select tst.refused(format($$insert into als_snapshots (project_id, file_name, saved_at, sha256, bytes, parser_version, data)
                          values (%s, 'copy.als', now(), repeat('a', 64), 100, 1, tst.set(1))$$, tst.p()), 'the same file twice');
-- Read again by a newer parser: the app upserts on (project_id, sha256).
select tst.affects(format($$insert into als_snapshots (project_id, file_name, saved_at, sha256, bytes, parser_version, data)
                          values (%s, 'khione 0.19.als', now(), repeat('a', 64), 100, 2,
                                  tst.set(2) || '{"tracks":[{"id":"1","kind":"audio","devices":[]}]}'::jsonb)
                          on conflict (project_id, sha256) do update set data = excluded.data, parser_version = excluded.parser_version
                          where als_snapshots.parser_version < excluded.parser_version$$, tst.p()), 1, 'a newer parser replaces the reading');
select tst.expect((select count(*) = 0 from als_plugins), 'and the plugin rows follow');
select tst.refused($$insert into als_plugins (snapshot_id, project_id, name, instances, active) select id, project_id, 'x', 1, 1 from als_snapshots$$,
                   'no direct writes to the plugin table');
select tst.refused(format($$insert into als_snapshots (project_id, file_name, saved_at, sha256, bytes, parser_version, data)
                          values (%s, 'bad.als', now(), 'nothex', 100, 1, tst.set(1))$$, tst.p()), 'a malformed fingerprint');

select tst.affects(format($$insert into project_folders (project_id, folder_name, files, file_count, total_bytes)
                          values (%s, 'Khione Project', '[{"path":"Samples/a.wav","bytes":5}]', 1, 5)$$, tst.p()), 1, 'an editor stores the folder listing');
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 1 from als_snapshots), 'a contributor reads the snapshots');
select tst.expect((select count(*) = 1 from project_folders), 'and the folder listing');
select tst.affects($$update project_folders set file_count = 0$$, 0, 'but changes neither');
select set_config('app.user_id', 'O', false);
select tst.expect((select count(*) = 0 from als_snapshots) and (select count(*) = 0 from project_folders), 'another account sees nothing');
select set_config('app.user_id', 'E', false);
select tst.affects($$delete from als_snapshots$$, 0, 'an editor cannot delete');
select set_config('app.user_id', 'J', false);
select tst.affects($$delete from als_snapshots$$, 1, 'the owner deletes');

reset role;
select 'all 014 tests passed' as result;

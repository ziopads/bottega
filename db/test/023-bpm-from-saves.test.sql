-- Tests for db/023-bpm-from-saves.sql: a project's BPM follows the tempo of
-- its newest save.
--
-- Run once against a fresh scratch database with 001–023 applied, never Neon.
--
--   psql -d bottega_test -f db/test/023-bpm-from-saves.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'Person A', 'active', true), ('C', 'c@x', 'Person B', 'active', false)
on conflict (user_id) do nothing;
insert into artists (code, name, account_id) values ('VIG', 'Artist V', 'J') on conflict do nothing;
insert into projects (kind, title, created_by, owner_id) values ('music', 'bpm-test', 'j@x', 'J');
insert into music_projects (project_id, artist_id, canonical_id)
  select p.id, a.id, '2026 1014 bpm test' from projects p, artists a where p.title = 'bpm-test' and a.code = 'VIG';
insert into shares (project_id, grantee_id, level, granted_by) select id, 'C', 'edit', 'J' from projects where title = 'bpm-test';
select set_config('app.actor', '', false);

create schema if not exists tst; grant usage on schema tst to bottega_app;
create or replace function tst.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.p() returns bigint language sql security definer as $$ select id from projects where title = 'bpm-test' $$;
create or replace function tst.bpm() returns numeric language sql security definer as $$
  select bpm from music_projects where project_id = tst.p() $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'C', false);

-- Person B, with edit access, stores saves as the app does.
create or replace function pg_temp.save(f text, at timestamptz, tempo text) returns void language sql as $$
  insert into als_snapshots (project_id, file_name, saved_at, sha256, bytes, parser_version, data)
  values (tst.p(), f, at, encode(sha256(convert_to(f, 'UTF8')), 'hex'), 100, 1,
          ('{"tracks":[],"samples":[],"tempo":' || tempo || '}')::jsonb) $$;

select pg_temp.save('bpm 0.01.als', '2026-10-01', '120');
select tst.expect(tst.bpm() = 120, 'the first save sets the BPM');

select pg_temp.save('bpm 0.03.als', '2026-10-03', '124.5');
select tst.expect(tst.bpm() = 124.5, 'a newer save sets it again');

select pg_temp.save('bpm 0.02.als', '2026-10-02', '90');
select tst.expect(tst.bpm() = 124.5, 'an older save stored later leaves the newest save''s tempo');

update music_projects set bpm = 100 where project_id = tst.p();
select pg_temp.save('bpm 0.04.als', '2026-10-04', 'null');
select tst.expect(tst.bpm() = 100, 'a newest save with no tempo leaves a hand BPM');

select pg_temp.save('bpm 0.05.als', '2026-10-05', '999');
select tst.expect(tst.bpm() = 100, 'a tempo out of range leaves it');

select pg_temp.save('bpm 0.06.als', '2026-10-06', '133.333');
select tst.expect(tst.bpm() = 133.33, 'the next save with a tempo replaces a hand BPM, to two places');

update als_snapshots set data = jsonb_set(data, '{tempo}', '140'), parser_version = 2 where file_name = 'bpm 0.06.als';
select tst.expect(tst.bpm() = 140, 'a save read again by a newer parser updates it');

reset role;
select set_config('app.user_id', '', false);
\echo 023 bpm from saves: all passed

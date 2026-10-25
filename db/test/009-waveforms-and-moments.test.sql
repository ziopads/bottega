-- Tests for db/009-waveforms-and-moments.sql: who may store a mix's
-- waveform, what a waveform may hold, and notes pinned to a moment.
--
-- Run once against a fresh scratch database with 001–009 applied, never Neon.
--
--   psql -d bottega_test -f db/test/009-waveforms-and-moments.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'Person A', 'active', true), ('C', 'c@x', 'Person B', 'active', false), ('G', 'g@x', 'Person C', 'active', false)
on conflict (user_id) do nothing;
insert into projects (kind, title, created_by, owner_id) values ('music', 'khione', 'j@x', 'J');
insert into audio (project_id, role, version, r2_key, original_filename, uploaded_by, uploaded_by_id)
  select id, 'mix', 1, 'k-khione', 'khione.mp3', 'j@x', 'J' from projects where title = 'khione';
insert into shares (project_id, grantee_id, level, granted_by)
  select id, 'C', 'contribute', 'J' from projects where title = 'khione';
insert into shares (project_id, grantee_id, level, granted_by)
  select id, 'G', 'view', 'J' from projects where title = 'khione';
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
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- Waveforms ---------------------------------------------------------------------------
select set_config('app.user_id', 'G', false);
select tst.affects($$update audio set peaks = '{1,2,3}' where original_filename = 'khione.mp3'$$, 0, 'a viewer cannot store a waveform');
select set_config('app.user_id', 'C', false);
select tst.affects($$update audio set peaks = (select array_agg((i % 256)::smallint) from generate_series(1, 1200) i)
                     where original_filename = 'khione.mp3'$$, 1, 'a contributor stores a waveform');
select tst.refused($$update audio set peaks = '{300}' where original_filename = 'khione.mp3'$$, 'a peak above 255');
select tst.refused($$update audio set peaks = (select array_agg(1::smallint) from generate_series(1, 2001))
                     where original_filename = 'khione.mp3'$$, 'more than 2000 peaks');
select tst.refused($$update audio set peaks = '{}' where original_filename = 'khione.mp3'$$, 'an empty waveform');
select tst.expect((select cardinality(peaks) from audio where original_filename = 'khione.mp3') = 1200, 'the waveform reads back');

-- Moments ------------------------------------------------------------------------------
insert into notes (project_id, audio_id, author, body, position_s)
  select project_id, id, 'c@x', 'the kick masks the bass', 151.5 from audio where original_filename = 'khione.mp3';
select tst.expect((select position_s = 151.5 from notes where body like 'the kick%'), 'a note pinned to 2:31.5');
select tst.refused($$insert into notes (project_id, audio_id, author, body, position_s)
                     select project_id, id, 'c@x', 'before the start', -1 from audio where original_filename = 'khione.mp3'$$,
  'a moment before the start');
select tst.affects($$update notes set position_s = 150 where body like 'the kick%'$$, 1, 'its author moves the moment');
select set_config('app.user_id', 'G', false);
select tst.expect((select position_s = 150 from notes where body like 'the kick%'), 'a viewer reads the moment');
reset role;

-- A deleted mix leaves the note and its moment.
delete from audio where original_filename = 'khione.mp3';
select tst.expect((select audio_id is null and position_s = 150 from notes where body like 'the kick%'),
  'deleting the mix keeps the note');

select set_config('app.user_id', '', false);
\echo 009 waveforms and moments tests passed

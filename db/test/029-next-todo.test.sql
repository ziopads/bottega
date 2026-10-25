-- Tests for db/029-next-todo.sql: the next to-do, passing the mark on, and the
-- next move and blocker carried over as to-dos.
--
-- Run once against a fresh scratch database with 001–029 applied, never Neon.
--
--   psql -d bottega_test -f db/test/029-next-todo.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status) values
  ('J', 'j@x', 'Person A', 'active'), ('C', 'c@x', 'Person B', 'active'), ('V', 'v@x', 'Viewer', 'active')
on conflict (user_id) do nothing;
insert into artists (code, name, account_id) values ('VIG', 'Artist V', 'J');
insert into projects (kind, title, created_by, owner_id) values ('music', 'khione', 'j@x', 'J'), ('music', 'old', 'j@x', 'J');
insert into music_projects (project_id, artist_id, canonical_id)
select p.id, (select id from artists where code = 'VIG'), v.cid from (values ('khione', '2025 0727'), ('old', '2024 0101')) v(t, cid)
  join projects p on p.title = v.t;
insert into shares (project_id, grantee_id, level, granted_by) select id, 'C', 'contribute', 'J' from projects where title = 'khione';
insert into shares (project_id, grantee_id, level, granted_by) select id, 'V', 'view', 'J' from projects where title = 'khione';
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
create or replace function tst.p(t text) returns bigint language sql security definer as $$ select id from projects where title = t $$;
create or replace function tst.c(w text) returns cards language sql security definer as $$ select * from cards where what = w $$;
create or replace function tst.next(p bigint) returns text language sql security definer as $$ select what from cards where project_id = p and is_next $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'J', false);
select workflow_start(tst.p('khione'));
insert into cards (project_id, stage, what, done_when) values
  (tst.p('khione'), 'seed', 'Loop the break', 'It loops'),
  (tst.p('khione'), 'seed', 'Tune the kick', 'Kick at D'),
  (tst.p('khione'), 'palette', 'Pick hats later', 'Hats picked');
select set_config('app.user_id', 'C', false);
insert into cards (project_id, stage, what, done_when) values (tst.p('khione'), 'seed', 'Person B: name tracks', 'Tracks named');

-- Marking --------------------------------------------------------------------------------------
select card_set_next(tst.p('khione'), (tst.c('Person B: name tracks')).id);
select tst.expect(tst.next(tst.p('khione')) = 'Person B: name tracks', 'a contributor marks a to-do next');
select set_config('app.user_id', 'J', false);
select card_set_next(tst.p('khione'), (tst.c('Tune the kick')).id);
select tst.expect(tst.next(tst.p('khione')) = 'Tune the kick', 'marking another moves the mark: one at a time');
select tst.refused(format('select card_set_next(%s, %s)', tst.p('old'), (tst.c('Tune the kick')).id), 'only a to-do of that project');
select set_config('app.user_id', 'V', false);
select tst.refused(format('select card_set_next(%s, null)', tst.p('khione')), 'a viewer cannot');

-- Passing the mark on ----------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
update cards set status = 'in progress' where what = 'Person B: name tracks';
update cards set status = 'done' where what = 'Tune the kick';
select tst.expect(tst.next(tst.p('khione')) = 'Person B: name tracks', 'done passes the mark on: in progress first');
update cards set status = 'done' where what = 'Person B: name tracks';
select tst.expect(tst.next(tst.p('khione')) = 'Loop the break', 'then the oldest open to-do of the current stage');
select card_to_note((tst.c('Loop the break')).id);
select tst.expect(tst.next(tst.p('khione')) is null, 'a to-do moved to a note passes it on; none left in the stage, none marked');
select tst.expect((tst.c('Pick hats later')).is_next = false, 'a to-do parked for a later stage never takes it');
select card_set_next(tst.p('khione'), (tst.c('Pick hats later')).id);
select tst.expect(tst.next(tst.p('khione')) = 'Pick hats later', 'though it can be marked by hand');
select card_set_next(tst.p('khione'), null);
select tst.expect(tst.next(tst.p('khione')) is null, 'and the mark cleared');
select tst.refused(format('select card_set_next(%s, %s)', tst.p('khione'), (tst.c('Tune the kick')).id), 'a done to-do cannot be next');

reset role;
select 'all 029 tests passed' as result;

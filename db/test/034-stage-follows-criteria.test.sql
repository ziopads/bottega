-- Tests for db/034-stage-follows-criteria.sql: the stage follows the exit
-- criteria, in both directions, and every move is kept with its cause.
--
-- Run once against a fresh scratch database with 001–034 applied, never Neon.
--
--   psql -d bottega_test -f db/test/034-stage-follows-criteria.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status) values
  ('J', 'j@x', 'Person A', 'active')
on conflict (user_id) do nothing;
insert into artists (code, name, account_id) values ('VIG', 'Artist V', 'J');
insert into projects (kind, title, created_by, owner_id) values ('music', 'khione', 'j@x', 'J'), ('music', 'old', 'j@x', 'J');
insert into music_projects (project_id, artist_id, canonical_id)
select p.id, (select id from artists where code = 'VIG'), v.cid from (values ('khione', '2025 0727'), ('old', '2024 0101')) v(t, cid)
  join projects p on p.title = v.t;
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
create or replace function tst.stage(p bigint) returns text language sql security definer as $$ select stage from project_workflow where project_id = p $$;
create or replace function tst.finished(p bigint) returns boolean language sql security definer as $$ select finished_at is not null from project_workflow where project_id = p $$;
create or replace function tst.moves(p bigint) returns bigint language sql security definer as $$ select count(*) from stage_moves where project_id = p $$;
create or replace function tst.last_move(p bigint) returns stage_moves language sql security definer as $$ select * from stage_moves where project_id = p order by id desc limit 1 $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'J', false);
select workflow_start(tst.p('khione'));
select workflow_start(tst.p('old'));

-- Starting ---------------------------------------------------------------------------------------
select tst.expect(tst.stage(tst.p('khione')) = 'seed', 'a started project is in its first stage');
select tst.expect(tst.moves(tst.p('khione')) = 1, 'copying every stage''s criteria at once logs no move of its own');

-- Forward: ticking moves the project on, past stages already complete --------------------------------
update exit_criteria set met_at = now() where project_id = tst.p('khione') and stage = 'seed';
select tst.expect(tst.stage(tst.p('khione')) = 'palette', 'every Seed criterion met: the project is in Palette');
select tst.expect((tst.last_move(tst.p('khione'))).reason = 'Exit criteria met', 'the move says why');
update exit_criteria set met_at = now() where project_id = tst.p('khione') and stage = 'structure';
select tst.expect(tst.stage(tst.p('khione')) = 'palette', 'a later stage ticked ahead does not move it');
update exit_criteria set met_at = now() where project_id = tst.p('khione') and stage = 'palette';
select tst.expect(tst.stage(tst.p('khione')) = 'detail', 'Palette met as well: past Structure, already complete, into Detail');

-- Back: unticking, or adding, in an earlier stage ----------------------------------------------------
update exit_criteria set met_at = null
 where id = (select id from exit_criteria where project_id = tst.p('khione') and stage = 'palette' order by position limit 1);
select tst.expect(tst.stage(tst.p('khione')) = 'palette', 'one Palette criterion unticked: back in Palette');
select tst.expect((tst.last_move(tst.p('khione'))).reason like 'Open criterion: %', 'the move names the criterion left open');
update exit_criteria set met_at = now() where project_id = tst.p('khione') and stage = 'palette';
select tst.expect(tst.stage(tst.p('khione')) = 'detail', 'ticked again: back in Detail');

insert into exit_criteria (project_id, stage, body, position) values (tst.p('khione'), 'seed', 'A new Seed criterion', 99);
select tst.expect(tst.stage(tst.p('khione')) = 'seed', 'a criterion added to an earlier stage makes it current');
update exit_criteria set met_at = now() where project_id = tst.p('khione') and stage = 'seed';
select tst.expect(tst.stage(tst.p('khione')) = 'detail', 'and ticking it returns the project to Detail');

-- A criterion that is not accepted does not count -------------------------------------------------
update exit_criteria set reviewed = true, rejected_at = now() where project_id = tst.p('khione') and stage = 'detail';
select tst.expect(tst.stage(tst.p('khione')) = 'mixdown', 'with every Detail criterion rejected, nothing holds the project in Detail');

-- Finished ---------------------------------------------------------------------------------------
update exit_criteria set met_at = now() where project_id = tst.p('khione');
select tst.expect(tst.stage(tst.p('khione')) = 'release', 'everything met: the last stage');
select tst.expect(tst.finished(tst.p('khione')), 'and the project is finished');
update exit_criteria set met_at = null
 where id = (select id from exit_criteria where project_id = tst.p('khione') and stage = 'release' order by position limit 1);
select tst.expect(not tst.finished(tst.p('khione')), 'unticking a Release criterion un-finishes it');
select tst.expect(tst.stage(tst.p('khione')) = 'release', 'and it stays in Release');
update exit_criteria set met_at = null
 where id = (select id from exit_criteria where project_id = tst.p('khione') and stage = 'seed' order by position limit 1);
select tst.expect(tst.stage(tst.p('khione')) = 'seed', 'unticking a Seed criterion from Release goes all the way back');

-- No criteria, no movement -------------------------------------------------------------------------
delete from exit_criteria where project_id = tst.p('old');
select tst.expect(tst.stage(tst.p('old')) = 'seed', 'a project with no criteria stays where it is');

-- Not callable by the app ----------------------------------------------------------------------------
select tst.refused(format('select workflow_sync_stage(%s)', tst.p('khione')), 'the application role cannot call workflow_sync_stage');

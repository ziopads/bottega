-- Tests for db/034-stage-follows-criteria.sql: the stage follows the exit
-- criteria and the to-dos, in both directions, and every move is kept with its
-- cause.
--
-- Run once against a fresh scratch database with 001–034 applied, never Neon.
--
--   psql -d bottega_test -f db/test/034-stage-follows-criteria.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status) values
  ('J', 'j@x', 'Person A', 'active'), ('C', 'c@x', 'Person B', 'active')
on conflict (user_id) do nothing;
insert into artists (code, name, account_id) values ('VIG', 'Artist V', 'J');
insert into projects (kind, title, created_by, owner_id) values
  ('music', 'khione', 'j@x', 'J'), ('music', 'old', 'j@x', 'J'), ('music', 'todos', 'j@x', 'J');
insert into music_projects (project_id, artist_id, canonical_id)
select p.id, (select id from artists where code = 'VIG'), v.cid
  from (values ('khione', '2025 0727'), ('old', '2024 0101'), ('todos', '2024 0202')) v(t, cid)
  join projects p on p.title = v.t;
insert into shares (project_id, grantee_id, level, granted_by) select id, 'C', 'contribute', 'J' from projects where title = 'todos';
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
create or replace function tst.c(w text) returns cards language sql security definer as $$ select * from cards where what = w $$;
create or replace function tst.next(p bigint) returns text language sql security definer as $$ select what from cards where project_id = p and is_next $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'J', false);
select workflow_start(tst.p('khione'));
select workflow_start(tst.p('old'));
select workflow_start(tst.p('todos'));

-- Starting ---------------------------------------------------------------------------------------
select tst.expect(tst.stage(tst.p('khione')) = 'seed', 'a started project is in its first stage');
select tst.expect(tst.moves(tst.p('khione')) = 1, 'copying every stage''s criteria at once logs no move of its own');

-- The first to-do in a fresh session takes the mark (the by-hand setting is not set yet) --------------
insert into cards (project_id, stage, what, done_when) values (tst.p('old'), 'seed', 'First to-do of the session', 'Done');
select tst.expect(tst.next(tst.p('old')) = 'First to-do of the session', 'the very first to-do added, with nothing set in the session, is marked next');
delete from cards where what = 'First to-do of the session';

-- Forward: ticking moves the project on, past stages already complete --------------------------------
update exit_criteria set met_at = now() where project_id = tst.p('khione') and stage = 'seed';
select tst.expect(tst.stage(tst.p('khione')) = 'palette', 'every Seed criterion met: the project is in Palette');
select tst.expect((tst.last_move(tst.p('khione'))).reason = 'Stage complete', 'the move says why');
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

-- To-dos hold a stage --------------------------------------------------------------------------------
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'seed', 'Tune the kick', 'Kick at D');
update exit_criteria set met_at = now() where project_id = tst.p('todos') and stage = 'seed';
select tst.expect(tst.stage(tst.p('todos')) = 'seed', 'every Seed criterion met but a Seed to-do open: still in Seed');
update cards set status = 'done' where what = 'Tune the kick';
select tst.expect(tst.stage(tst.p('todos')) = 'palette', 'the to-do done: the stage is complete and the project moves on');
update cards set status = 'accepted' where what = 'Tune the kick';
select tst.expect(tst.stage(tst.p('todos')) = 'seed', 'a done to-do reopened: back in Seed');
select tst.expect((tst.last_move(tst.p('todos'))).reason = 'Open to-do: Tune the kick', 'the move names the to-do left open');
update cards set status = 'done' where what = 'Tune the kick';

-- Adding, moving and deleting to-dos -----------------------------------------------------------------
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'palette', 'Pick the pad', 'Pad picked');
select tst.expect(tst.stage(tst.p('todos')) = 'palette', 'a to-do added to the current stage keeps the project there');
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'detail', 'Second drop fill', 'Fill plays');
select tst.expect(tst.stage(tst.p('todos')) = 'palette', 'a to-do added to a later stage is parked and moves nothing');
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'seed', 'Name the tracks', 'Tracks named');
select tst.expect(tst.stage(tst.p('todos')) = 'seed', 'a to-do added to an earlier stage makes that stage current');
update cards set stage = 'detail' where what = 'Name the tracks';
select tst.expect(tst.stage(tst.p('todos')) = 'palette', 'moved to a later stage it no longer holds Seed');
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'seed', 'Check the loop', 'Loop checked');
select tst.expect(tst.stage(tst.p('todos')) = 'seed', 'another earlier to-do pulls the project back');
delete from cards where what = 'Check the loop';
select tst.expect(tst.stage(tst.p('todos')) = 'palette', 'deleting it frees the stage');

-- What does not count ----------------------------------------------------------------------------------
insert into cards (project_id, stage, what, done_when, origin, status) values (tst.p('todos'), 'seed', 'Claude suggests', 'Done', 'assistant', 'proposed');
select tst.expect(tst.stage(tst.p('todos')) = 'palette', 'a proposal waiting for review does not count');
update cards set status = 'accepted' where what = 'Claude suggests';
select tst.expect(tst.stage(tst.p('todos')) = 'seed', 'accepted, it does');
select card_settle((tst.c('Claude suggests')).id, 'Decided');
select tst.expect(tst.stage(tst.p('todos')) = 'palette', 'a settled decision is not outstanding work');

-- The next to-do follows the stage -------------------------------------------------------------------
select card_set_next(tst.p('todos'), (tst.c('Pick the pad')).id);
select tst.expect(tst.next(tst.p('todos')) = 'Pick the pad', 'the next mark is on a Palette to-do');
update cards set status = 'done' where what = 'Pick the pad';
select tst.expect(tst.next(tst.p('todos')) is null, 'done with nothing else open in the stage: no mark');
update cards set status = 'accepted' where what = 'Tune the kick';
select tst.expect(tst.stage(tst.p('todos')) = 'seed', 'a Seed to-do reopened: back in Seed');
select tst.expect(tst.next(tst.p('todos')) = 'Tune the kick', 'and the mark goes to the stage''s first open to-do');
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'palette', 'Layer the pad', 'Pad layered');
select tst.expect(tst.next(tst.p('todos')) = 'Tune the kick', 'a to-do parked for Palette does not take the mark');
update cards set status = 'done' where what = 'Tune the kick';
select tst.expect(tst.stage(tst.p('todos')) = 'palette', 'the Seed to-do done: on to Palette');
select tst.expect(tst.next(tst.p('todos')) = 'Layer the pad', 'moving on to Palette, the mark goes to its open to-do');

-- A to-do added to a stage with none marked becomes the next ----------------------------------------
select card_set_next(tst.p('todos'), null);
select tst.expect(tst.next(tst.p('todos')) is null, 'the mark can be cleared by hand and stays cleared');
update cards set status = 'done' where what = 'Layer the pad';
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'palette', 'First new Palette to-do', 'Done');
select tst.expect(tst.next(tst.p('todos')) = 'First new Palette to-do', 'a to-do added when none is marked takes the mark');
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'palette', 'Second new Palette to-do', 'Done');
select tst.expect(tst.next(tst.p('todos')) = 'First new Palette to-do', 'a second one does not take it');
delete from cards where what in ('First new Palette to-do', 'Second new Palette to-do');
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'palette', 'After deleting all', 'Done');
select tst.expect(tst.next(tst.p('todos')) = 'After deleting all', 'after deleting every to-do, the next one added is marked');
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'detail', 'Parked one', 'Done');
select tst.expect(tst.next(tst.p('todos')) = 'After deleting all', 'a parked to-do for a later stage never takes the mark');
delete from cards where what in ('After deleting all', 'Parked one');

-- A contribute-level collaborator moves the stage through their own to-dos --------------------------------
select set_config('app.user_id', 'C', false);
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'seed', 'Person B check', 'Checked');
select tst.expect(tst.stage(tst.p('todos')) = 'seed', 'a collaborator adding an earlier to-do makes that stage current');
select tst.expect((tst.last_move(tst.p('todos'))).moved_by = 'C', 'and the move is theirs');
update cards set status = 'done' where what = 'Person B check';
select tst.expect(tst.stage(tst.p('todos')) = 'palette', 'their closing it moves the project on');
select set_config('app.user_id', 'J', false);

-- Finished needs no open to-do in the last stage ---------------------------------------------------------
update cards set status = 'done' where project_id = tst.p('todos');
update exit_criteria set met_at = now() where project_id = tst.p('todos');
select tst.expect(tst.stage(tst.p('todos')) = 'release' and tst.finished(tst.p('todos')), 'everything done: Release, finished');
insert into cards (project_id, stage, what, done_when) values (tst.p('todos'), 'release', 'Send the promo', 'Promo sent');
select tst.expect(not tst.finished(tst.p('todos')), 'an open Release to-do un-finishes it');
update cards set status = 'done' where what = 'Send the promo';
select tst.expect(tst.finished(tst.p('todos')), 'and done, it is finished again');

-- Deleting a project with to-dos ---------------------------------------------------------------------------
delete from projects where id = tst.p('todos');
select tst.expect(not exists (select 1 from project_workflow where project_id not in (select id from projects)), 'deleting a project with to-dos and criteria goes through');

-- Not callable by the app ----------------------------------------------------------------------------
select tst.refused(format('select workflow_sync_stage(%s)', tst.p('khione')), 'the application role cannot call workflow_sync_stage');

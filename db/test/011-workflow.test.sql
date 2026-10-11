-- Tests for db/011-workflow.sql: stages and moves, exit criteria, elements,
-- cards, proposals, settled decisions, and who may do each.
--
-- Run once against a fresh scratch database with 001–011 applied, never Neon.
--
--   psql -d bottega_test -f db/test/011-workflow.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('E', 'e@x', 'Eddie', 'active', false),
  ('C', 'c@x', 'Chris', 'active', false), ('G', 'g@x', 'Gordon', 'active', false),
  ('O', 'o@x', 'Other', 'active', false)
on conflict (user_id) do nothing;
insert into artists (code, name, account_id) values ('VIG', 'Vigorish', 'J');
insert into projects (kind, title, created_by, owner_id) values ('music', 'khione', 'j@x', 'J'), ('music', 'other', 'j@x', 'J');
insert into music_projects (project_id, canonical_id, artist_id)
  select p.id, '2025 0727', a.id from projects p, artists a where p.title = 'khione';
insert into audio (project_id, role, version, r2_key, original_filename, uploaded_by, uploaded_by_id)
  select id, 'mix', 1, 'k1', 'khione v1.mp3', 'j@x', 'J' from projects where title = 'khione';
insert into audio (project_id, role, version, r2_key, original_filename, uploaded_by, uploaded_by_id)
  select id, 'mix', 1, 'o1', 'other v1.mp3', 'j@x', 'J' from projects where title = 'other';
insert into notes (project_id, audio_id, author, author_id, body, position_s)
  select p.id, a.id, 'Chris', 'C', 'The second drop is flat', 95 from projects p join audio a on a.project_id = p.id
   where p.title = 'khione';
insert into shares (project_id, grantee_id, level, granted_by)
  select id, 'E', 'edit', 'J' from projects where title = 'khione';
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
-- Ids by name, read as the owner whatever the person may see.
create or replace function tst.p(t text) returns bigint language sql security definer as $$ select id from projects where title = t $$;
create or replace function tst.mix(t text) returns bigint language sql security definer as
  $$ select a.id from audio a join projects p on p.id = a.project_id where p.title = t $$;
create or replace function tst.el(n text) returns bigint language sql security definer as $$ select id from elements where name = n limit 1 $$;
create or replace function tst.card(w text) returns bigint language sql security definer as $$ select id from cards where what = w $$;
create or replace function tst.note() returns bigint language sql security definer as $$ select id from notes limit 1 $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- Stages ------------------------------------------------------------------------------------
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 4 from workflow_stages where kind = 'music'), 'four music stages');
select tst.refused(format('select workflow_start(%s)', tst.p('khione')), 'a viewer cannot start the workflow');
select set_config('app.user_id', 'C', false);
select tst.refused(format('select workflow_start(%s)', tst.p('khione')), 'nor can a contributor');
select set_config('app.user_id', 'E', false);
select tst.expect(workflow_start(tst.p('khione')) = 'sketch', 'an editor starts the workflow at sketch');
select tst.expect(workflow_start(tst.p('khione')) = 'sketch', 'starting again changes nothing');
select tst.expect((select count(*) = 1 from stage_moves where project_id = tst.p('khione')), 'the start is recorded once');
select tst.refused($$insert into project_workflow (project_id, kind, stage) values (1, 'music', 'mix')$$, 'no direct writes to the stage');
select tst.refused(format('select workflow_move(%s, %L, null)', tst.p('khione'), 'mix'), 'no skipping a stage');
select tst.refused(format('select workflow_move(%s, %L, null)', tst.p('khione'), 'sketch'), 'no move to the same stage');
select tst.refused(format('select workflow_move(%s, %L, null)', tst.p('khione'), 'artwork'), 'no stage of another kind');

-- Exit criteria -------------------------------------------------------------------------------
select tst.affects(format($$insert into exit_criteria (project_id, stage, body) values (%s, 'sketch', 'Main idea recorded'),
                          (%s, 'sketch', 'Tempo and key chosen')$$, tst.p('khione'), tst.p('khione')), 2, 'an editor writes exit criteria');
select tst.refused(format($$insert into exit_criteria (project_id, stage, body) values (%s, 'release', 'x')$$, tst.p('khione')),
                   'a criterion for a stage of another kind');
select tst.affects(format($$insert into exit_criteria (project_id, stage, body, origin, reviewed) values (%s, 'sketch', 'Proposed by Claude', 'assistant', false)$$,
                   tst.p('khione')), 1, 'a proposed criterion');
select tst.refused(format($$insert into exit_criteria (project_id, stage, body, reviewed) values (%s, 'sketch', 'unreviewed human', false)$$, tst.p('khione')),
                   'only Claude''s criteria start unreviewed');
select tst.refused(format('select workflow_move(%s, %L, null)', tst.p('khione'), 'arrange'), 'advancing with criteria unmet');
select tst.affects($$update exit_criteria set met_at = now() where body in ('Main idea recorded', 'Tempo and key chosen')$$, 2, 'ticking the criteria');
select tst.expect((select bool_and(met_by = 'E') from exit_criteria where met_at is not null), 'whoever ticks is recorded');
select tst.expect(workflow_move(tst.p('khione'), 'arrange', null) = 'arrange', 'an unreviewed proposal does not hold up a move');
select tst.refused(format('select workflow_move(%s, %L, %L)', tst.p('khione'), 'sketch', '  '), 'moving back without a reason');
select tst.expect(workflow_move(tst.p('khione'), 'sketch', 'The hook is not there yet') = 'sketch', 'moving back with a reason');
select tst.expect((select reason = 'The hook is not there yet' from stage_moves where to_stage = 'sketch' and from_stage = 'arrange'),
                  'the reason is kept');
select workflow_move(tst.p('khione'), 'arrange', null);
select set_config('app.user_id', 'C', false);
select tst.refused(format($$insert into exit_criteria (project_id, stage, body) values (%s, 'arrange', 'x')$$, tst.p('khione')),
                   'a contributor cannot write criteria');
select tst.affects($$update exit_criteria set met_at = null$$, 0, 'nor tick them');

-- Elements ----------------------------------------------------------------------------------
select set_config('app.user_id', 'E', false);
select tst.affects(format($$insert into elements (project_id, name, position) values (%s, 'TACTUS', 1), (%s, 'STRUCTURE', 7)$$,
                   tst.p('khione'), tst.p('khione')), 2, 'an editor adds elements');
select tst.affects(format($$insert into elements (project_id, parent_id, name) values (%s, %s, 'Kick')$$, tst.p('khione'), tst.el('TACTUS')),
                   1, 'a child element');
select tst.refused(format($$insert into elements (project_id, parent_id, name) values (%s, %s, 'Stray')$$, tst.p('other'), tst.el('TACTUS')),
                   'a parent from another project');
select tst.refused(format($$update elements set parent_id = %s where name = 'TACTUS'$$, tst.el('Kick')), 'an element under its own child');
select set_config('app.user_id', 'C', false);
select tst.refused(format($$insert into elements (project_id, name) values (%s, 'VOX')$$, tst.p('khione')), 'a contributor cannot add elements');

-- Cards ---------------------------------------------------------------------------------------
select tst.affects(format($$insert into cards (project_id, element_id, stage, kind, what, done_when)
                          values (%s, %s, 'arrange', 'arrangement', 'Lift the second drop', 'It hits harder than the first')$$,
                   tst.p('khione'), tst.el('STRUCTURE')), 1, 'a contributor adds a card');
select tst.refused(format($$insert into cards (project_id, stage, what) values (%s, 'arrange', 'No done-when')$$, tst.p('khione')),
                   'a card needs how it will be known to be done');
select tst.refused(format($$insert into cards (project_id, stage, what, done_when, status) values (%s, 'arrange', 'x', 'y', 'proposed')$$,
                   tst.p('khione')), 'only Claude''s cards are proposed');
select tst.refused(format($$insert into cards (project_id, stage, what, done_when, settled) values (%s, 'arrange', 'x', 'y', true)$$,
                   tst.p('khione')), 'a card is not inserted settled');
select tst.refused(format($$insert into cards (project_id, element_id, stage, what, done_when) values (%s, %s, 'arrange', 'x', 'y')$$,
                   tst.p('other'), tst.el('STRUCTURE')), 'an element from another project');
select tst.refused(format($$insert into cards (project_id, stage, what, done_when, audio_id, position_s) values (%s, 'arrange', 'x', 'y', %s, 3)$$,
                   tst.p('khione'), tst.mix('other')), 'a mix from another project');
select tst.affects(format($$insert into cards (project_id, stage, kind, what, done_when, status, origin)
                          values (%s, 'mix', 'mix', 'Tame 3 kHz on the lead', 'No harshness at loud playback', 'proposed', 'assistant')$$,
                   tst.p('khione')), 1, 'a proposal, parked for the mix stage');
select tst.affects($$update cards set status = 'in progress' where what = 'Lift the second drop'$$, 1, 'a contributor moves their own card');
select tst.affects($$update cards set status = 'rejected' where what = 'Tame 3 kHz on the lead'$$, 1,
                   'and their own proposal (made through Claude as them)');
select set_config('app.user_id', 'E', false);
select tst.affects(format($$insert into cards (project_id, stage, what, done_when) values (%s, 'arrange', 'Editor card', 'done')$$, tst.p('khione')),
                   1, 'an editor adds a card');
select set_config('app.user_id', 'C', false);
select tst.affects($$update cards set status = 'done' where what = 'Editor card'$$, 0, 'a contributor cannot move another''s card');
select tst.affects($$delete from cards where what = 'Lift the second drop'$$, 0, 'nor delete their own');
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 3 from cards where project_id = tst.p('khione')), 'a viewer reads the cards');
select tst.refused(format($$insert into cards (project_id, stage, what, done_when) values (%s, 'arrange', 'x', 'y')$$, tst.p('khione')),
                   'but adds none');
select set_config('app.user_id', 'O', false);
select tst.expect((select count(*) = 0 from cards), 'another account sees no cards');
select tst.expect((select count(*) = 0 from project_workflow), 'nor the stage');

-- Settled decisions ------------------------------------------------------------------------
select set_config('app.user_id', 'C', false);
select tst.refused(format('select card_settle(%s, %L)', tst.card('Editor card'), 'x'), 'a contributor cannot settle');
select tst.refused($$update cards set settled = true where what = 'Lift the second drop'$$, 'no direct writes to settled');
select set_config('app.user_id', 'E', false);
select card_settle(tst.card('Editor card'), 'Chosen after A/B');
select tst.expect((select settled and settled_reason = 'Chosen after A/B' from cards where what = 'Editor card'), 'an editor settles a card');
select tst.refused(format('select card_reopen(%s, %L)', tst.card('Editor card'), ' '), 'reopening without a reason');
select tst.expect(card_reopen(tst.card('Editor card'), 'New reference changes things') = 1, 'reopening with a reason counts it');
select tst.expect((select not settled and reopen_count = 1 from cards where what = 'Editor card'), 'the card is open again');
select tst.refused(format('select card_reopen(%s, %L)', tst.card('Editor card'), 'again'), 'reopening what is not settled');
select tst.expect((select note_settle(tst.note(), 'Agreed in session', tst.el('STRUCTURE'))) is not null, 'a note becomes a settled decision');
select tst.expect((select settled and stage = 'arrange' and position_s = 95 and audio_id is not null and what = 'The second drop is flat'
                     from cards where source_note_id = tst.note()), 'carrying its text, mix, moment and the current stage');
select tst.expect(note_settle(tst.note(), 'twice', null) = (select id from cards where source_note_id = tst.note()),
                  'settling the same note again returns the same decision');

-- Deleting ---------------------------------------------------------------------------------------
select tst.affects($$delete from cards where what = 'Editor card'$$, 0, 'an editor cannot delete');
select set_config('app.user_id', 'J', false);
select tst.affects($$delete from cards where what = 'Editor card'$$, 1, 'the owner deletes a card');
select tst.affects($$delete from elements where name = 'TACTUS'$$, 1, 'the owner deletes an element');
select tst.expect((select count(*) = 0 from elements where name = 'Kick'), 'its children go with it');

reset role;
select 'all 011 tests passed' as result;

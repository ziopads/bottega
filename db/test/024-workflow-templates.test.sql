-- Tests for db/024-workflow-templates.sql: templates and their copies, each
-- project's own stages, starting from a template, moves over a project's
-- stages, finishing, bringing in template changes, the next move and the
-- work log, and the board with its rotation limit.
--
-- Run once against a fresh scratch database with 001–024 applied, never Neon.
--
--   psql -d bottega_test -f db/test/024-workflow-templates.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('E', 'e@x', 'Eddie', 'active', false),
  ('C', 'c@x', 'Chris', 'active', false), ('G', 'g@x', 'Gordon', 'active', false),
  ('O', 'o@x', 'Other', 'active', false)
on conflict (user_id) do nothing;
insert into projects (kind, title, created_by, owner_id) values
  ('music', 'khione', 'j@x', 'J'), ('music', 'other', 'j@x', 'J'), ('music', 'third', 'j@x', 'J'),
  ('music', 'fourth', 'j@x', 'J'), ('music', 'gordons', 'g@x', 'G'), ('collection', 'album', 'j@x', 'J');
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
-- Read as the owner, whatever the person may see.
create or replace function tst.p(t text) returns bigint language sql security definer as $$ select id from projects where title = t $$;
create or replace function tst.default_music() returns bigint language sql security definer as
  $$ select id from workflow_templates where owner_id is null and kind = 'music' $$;
create or replace function tst.tpl(n text) returns bigint language sql security definer as
  $$ select id from workflow_templates where name = n and owner_id is not null $$;
create or replace function tst.tstage(t bigint, k text) returns bigint language sql security definer as
  $$ select id from template_stages where template_id = t and key = k $$;
create or replace function tst.version(t bigint) returns int language sql security definer as
  $$ select version from workflow_templates where id = t $$;
create or replace function tst.crit(p bigint, b text) returns exit_criteria language sql security definer as
  $$ select * from exit_criteria where project_id = p and body = b $$;
create or replace function tst.pw(p bigint) returns project_workflow language sql security definer as
  $$ select * from project_workflow where project_id = p $$;
create or replace function tst.place(u text, p bigint) returns text language sql security definer as
  $$ select place from board_places where user_id = u and project_id = p $$;
create or replace function tst.met_all(p bigint, st text) returns void language sql security definer as
  $$ update exit_criteria set met_at = now() where project_id = p and stage = st and met_at is null $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- Templates ---------------------------------------------------------------------------------
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 7 from template_stages where template_id = tst.default_music()),
                  'every account reads the platform''s music template: seven stages');
select tst.expect((select string_agg(key, ',' order by position) from template_stages where template_id = tst.default_music())
                  = 'seed,palette,structure,detail,mixdown,master,release', 'Seed to Release, Palette its own stage');
select tst.expect((select count(*) = 32 from template_criteria tc join template_stages ts on ts.id = tc.stage_id
                    where ts.template_id = tst.default_music()), 'with 32 criteria');
select tst.expect((select hint like E'%\n  low mids%' from template_criteria where body = 'Gain staged, master left clean'),
                  'a hint keeps its indented lines');
select tst.expect((select count(*) = 10 from workflow_checks), 'ten checks to choose from');
select tst.refused(format($$insert into template_stages (template_id, key, position, label) values (%s, 'extra', 8, 'Extra')$$,
                          tst.default_music()), 'nobody edits the platform''s template');
select tst.affects(format($$update template_criteria set body = 'x' where stage_id = %s$$, tst.tstage(tst.default_music(), 'seed')),
                   0, 'nor its criteria');

select set_config('app.user_id', 'J', false);
select tst.expect(template_copy(tst.default_music(), 'Sirsinate club') is not null, 'an account copies the default');
select tst.expect((select owner_id = 'J' and copied_from = tst.default_music() and version = 1
                     from workflow_templates where id = tst.tpl('Sirsinate club')), 'the copy is its own, at version 1');
select tst.expect((select count(*) = 32 from template_criteria tc join template_stages ts on ts.id = tc.stage_id
                    join template_criteria d on d.uid = tc.uid
                    where ts.template_id = tst.tpl('Sirsinate club') and d.stage_id in
                      (select id from template_stages where template_id = tst.default_music())),
                  'its criteria keep their uids');
select tst.refused($$select template_copy(tst.default_music(), 'Sirsinate club')$$, 'one name per account and kind');
select tst.affects(format($$insert into template_criteria (stage_id, position, body, hint) values (%s, 5, 'Sketch bounced to the phone', 'Listen away from the studio.')$$,
                          tst.tstage(tst.tpl('Sirsinate club'), 'seed')), 1, 'the owner adds a criterion to their template');
select tst.expect(tst.version(tst.tpl('Sirsinate club')) > 1, 'which raises its version');
select tst.affects(format($$update template_stages set label = 'Mix' where id = %s$$, tst.tstage(tst.tpl('Sirsinate club'), 'mixdown')),
                   1, 'and renames a stage');
select tst.refused(format($$update template_stages set key = 'mix' where id = %s$$, tst.tstage(tst.tpl('Sirsinate club'), 'mixdown')),
                   'a stage''s key never changes');
select tst.refused(format($$insert into template_criteria (stage_id, body, check_key) values (%s, 'x', 'no_such_check')$$,
                          tst.tstage(tst.tpl('Sirsinate club'), 'seed')), 'a check comes from the fixed list');

select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 0 from workflow_templates where owner_id = 'J'), 'another account cannot see the copy');
select tst.affects(format('update template_stages set label = %L where template_id = %s', 'Hijack', tst.tpl('Sirsinate club')),
                   0, 'nor change it');
select tst.refused(format('select template_copy(%s, %L)', tst.tpl('Sirsinate club'), 'Stolen'), 'nor copy it');
select tst.refused(format('insert into account_preferences (user_id, music_template_id) values (%L, %s)', 'G', tst.tpl('Sirsinate club')),
                   'nor choose it as their template');

-- Preferences ---------------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
insert into account_preferences (user_id, music_template_id) values ('J', tst.tpl('Sirsinate club'));
select tst.expect((select rotation_limit = 4 and cold_days = 21 from account_preferences where user_id = 'J'),
                  'four in rotation and cold after 21 days by default');
select tst.refused($$update account_preferences set rotation_limit = 0 where user_id = 'J'$$, 'rotation holds at least one');
select tst.affects($$update account_preferences set rotation_limit = 2, cold_days = 14 where user_id = 'J'$$, 1,
                   'an account sets its own limits');

-- Starting from a template -----------------------------------------------------------------------
select tst.expect((select count(*) = 7 and bool_or(label = 'Mix') from project_stage_list(tst.p('khione'))),
                  'before it starts, a project''s stages are its owner''s template''s');
select set_config('app.user_id', 'C', false);
select tst.refused(format('select workflow_start(%s)', tst.p('khione')), 'a contributor cannot start the workflow');
select set_config('app.user_id', 'E', false);
select tst.expect(workflow_start(tst.p('khione')) = 'seed', 'an editor starts it at Seed');
select tst.expect((select count(*) = 7 from project_stages where project_id = tst.p('khione')), 'the project has its own seven stages');
select tst.expect((select template_id = tst.tpl('Sirsinate club') and template_version = tst.version(tst.tpl('Sirsinate club'))
                     from project_workflow where project_id = tst.p('khione')),
                  'from the owner''s template, not the editor''s, at its current version');
select tst.expect((select count(*) = 33 and count(*) filter (where template_uid is not null) = 33
                     from exit_criteria where project_id = tst.p('khione')), 'every stage''s criteria copied, with their uids');
select tst.expect((select hint = 'Listen away from the studio.' from exit_criteria
                    where project_id = tst.p('khione') and body = 'Sketch bounced to the phone'), 'hints come too');
select tst.expect((select check_key = 'locators' from exit_criteria
                    where project_id = tst.p('khione') and body = 'A named locator at each section'), 'and checks');
select tst.expect(workflow_start(tst.p('khione')) = 'seed', 'starting again changes nothing');
select tst.expect((select count(*) = 33 from exit_criteria where project_id = tst.p('khione')), 'and copies nothing twice');
select tst.expect(tst.place('J', tst.p('khione')) = 'backlog', 'the project lands in its owner''s backlog');
select tst.expect(tst.place('E', tst.p('khione')) is null, 'not in the editor''s');

-- Template edits after the start do not reach the project.
select set_config('app.user_id', 'J', false);
update template_stages set label = 'Mixdown' where id = tst.tstage(tst.tpl('Sirsinate club'), 'mixdown');
select tst.expect((select label = 'Mix' from project_stages where project_id = tst.p('khione') and key = 'mixdown'),
                  'a template change does not reach a project underway');

-- Moving over the project's stages ------------------------------------------------------------------
select set_config('app.user_id', 'E', false);
select tst.refused(format('select workflow_move(%s, %L, null)', tst.p('khione'), 'palette'), 'advancing with criteria unmet');
update exit_criteria set met_at = now() where project_id = tst.p('khione') and stage = 'seed';
select tst.expect(workflow_move(tst.p('khione'), 'palette', null) = 'palette', 'advancing once Seed is met');
select tst.refused(format('select workflow_move(%s, %L, null)', tst.p('khione'), 'detail'), 'no skipping a stage');
select tst.refused(format('select workflow_move(%s, %L, null)', tst.p('khione'), 'sketch'), 'an old stage key is gone');
select tst.refused(format('select workflow_move(%s, %L, %L)', tst.p('khione'), 'seed', ''), 'moving back needs a reason');
select tst.expect(workflow_move(tst.p('khione'), 'seed', 'The loop is not there yet') = 'seed', 'moving back with a reason');
select workflow_move(tst.p('khione'), 'palette', null);
select tst.affects(format($$insert into cards (project_id, stage, what, done_when) values (%s, 'detail', 'Fill into drop 2', 'A fill leads in')$$,
                          tst.p('khione')), 1, 'a card for a later stage of the project');
select tst.refused(format($$insert into cards (project_id, stage, what, done_when) values (%s, 'arrange', 'x', 'y')$$, tst.p('khione')),
                   'a card in a stage the project does not have');
select tst.refused(format($$insert into exit_criteria (project_id, stage, body) values (%s, 'mix', 'x')$$, tst.p('khione')),
                   'nor a criterion');
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 7 from project_stages where project_id = tst.p('khione')), 'a viewer reads the project''s stages');
select set_config('app.user_id', 'O', false);
select tst.expect((select count(*) = 0 from project_stages where project_id = tst.p('khione')), 'someone with no access does not');
select tst.refused($$insert into project_stages (project_id, key, position, label) values (1, 'extra', 9, 'Extra')$$,
                   'no direct writes to a project''s stages');

-- Bringing in template changes ---------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
update template_criteria set body = 'Kick and snare tuned to the key' where body = 'Kick and snare chosen and tuned to the key'
   and stage_id = tst.tstage(tst.tpl('Sirsinate club'), 'palette');
insert into template_criteria (stage_id, position, body) values (tst.tstage(tst.tpl('Sirsinate club'), 'structure'), 5, 'Arrangement timed against the reference');
select set_config('app.user_id', 'G', false);
select tst.expect((select version > seen_version and name = 'Sirsinate club' from workflow_template_status(tst.p('khione'))),
                  'a viewer sees the template has moved on');
select tst.expect((select count(*) = 34 from workflow_template_criteria(tst.p('khione'))), 'and reads the template''s criteria');
select set_config('app.user_id', 'O', false);
select tst.expect((select count(*) = 0 from workflow_template_status(tst.p('khione'))), 'someone with no access sees nothing');
select set_config('app.user_id', 'E', false);
update exit_criteria set met_at = now() where project_id = tst.p('khione') and body = 'Kick and snare chosen and tuned to the key';
select set_config('app.user_id', 'C', false);
select tst.refused(format('select template_apply(%s, %L::uuid[])', tst.p('khione'), '{}'), 'a contributor cannot bring changes in');
select set_config('app.user_id', 'E', false);
select tst.expect(template_apply(tst.p('khione'),
                    array(select uid from workflow_template_criteria(tst.p('khione')) where body in ('Kick and snare tuned to the key', 'Arrangement timed against the reference')))
                  = 2, 'an editor brings in a changed criterion and a new one');
select tst.expect((select met_at is not null from exit_criteria where project_id = tst.p('khione') and body = 'Kick and snare tuned to the key'),
                  'the changed one keeps being met');
select tst.expect((select count(*) = 1 from exit_criteria where project_id = tst.p('khione') and stage = 'structure'
                     and body = 'Arrangement timed against the reference'), 'the new one lands in its stage');
select tst.expect((select label = 'Mixdown' from project_stages where project_id = tst.p('khione') and key = 'mixdown'),
                  'stage labels follow the template');
select tst.expect((select version = seen_version from workflow_template_status(tst.p('khione'))), 'the version is marked seen');
select tst.expect(template_apply(tst.p('khione'),
                    array(select uid from workflow_template_criteria(tst.p('khione')) where body = 'Arrangement timed against the reference')) = 0,
                  'bringing it in twice adds nothing');

-- The next move and the work log -------------------------------------------------------------------
select set_config('app.user_id', 'G', false);
select tst.refused(format('select workflow_set_next(%s, %L, null)', tst.p('khione'), 'x'), 'a viewer cannot set the next move');
select set_config('app.user_id', 'C', false);
select workflow_set_next(tst.p('khione'), '  Tune the hats to D  ', 'The break loses energy');
select tst.expect(((tst.pw(tst.p('khione'))).next_move = 'Tune the hats to D'), 'a contributor sets the next move');
select tst.expect(((tst.pw(tst.p('khione'))).blocker_set_at is not null), 'and a blocker, dated');
select pg_sleep(0.01);
create temporary table b_at as select (tst.pw(tst.p('khione'))).blocker_set_at as at;
select workflow_set_next(tst.p('khione'), null, 'The break loses energy');
select tst.expect(((tst.pw(tst.p('khione'))).blocker_set_at = (select at from b_at)), 'the same blocker keeps its date');
select tst.expect(((tst.pw(tst.p('khione'))).next_move = 'Tune the hats to D'), 'null leaves the next move alone');
select tst.expect(work_log_add(tst.p('khione'), 'Hats tuned', 'Name the locators') is not null, 'ending a session logs it');
select tst.expect(((tst.pw(tst.p('khione'))).next_move = 'Name the locators'), 'and sets the next move');
select tst.refused(format('select work_log_add(%s, %L, %L)', tst.p('khione'), ' ', ''), 'an empty session is refused');
select tst.refused(format('select work_log_add(%s, %L, %L)', tst.p('third'), 'x', 'y'), 'nor on a project without access');
select workflow_set_next(tst.p('khione'), null, '');
select tst.expect(((tst.pw(tst.p('khione'))).blocker_set_at is null), 'clearing the blocker clears its date');
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 1 from work_log where project_id = tst.p('khione')), 'a viewer reads the log');

-- Finished -------------------------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
select workflow_start(tst.p('other'));
do $$
declare k text;
begin
  for k in select key from project_stages where project_id = tst.p('other') and key <> 'release' order by position loop
    perform tst.met_all(tst.p('other'), k);
    perform workflow_move(tst.p('other'), (select key from project_stages where project_id = tst.p('other')
                                            and position = (select position + 1 from project_stages where project_id = tst.p('other') and key = k)), null);
  end loop;
end $$;
select tst.expect(((tst.pw(tst.p('other'))).stage = 'release'), 'a project reaches Release');
select tst.expect(((tst.pw(tst.p('other'))).finished_at is null), 'not finished while Release criteria are open');
select tst.met_all(tst.p('other'), 'release');
select tst.expect(((tst.pw(tst.p('other'))).finished_at is not null), 'finished once every Release criterion is met');
update exit_criteria set met_at = null where project_id = tst.p('other') and body = 'Promo copies sent to DJs';
select tst.expect(((tst.pw(tst.p('other'))).finished_at is null), 'unticking one takes it back');
update exit_criteria set met_at = now() where project_id = tst.p('other') and body = 'Promo copies sent to DJs';
select workflow_move(tst.p('other'), 'master', 'One more pass on the limiter');
select tst.expect(((tst.pw(tst.p('other'))).finished_at is null), 'so does moving back from Release');
select workflow_move(tst.p('other'), 'release', null);
select tst.expect(((tst.pw(tst.p('other'))).finished_at is not null), 'and returning finishes it again');

-- The board -------------------------------------------------------------------------------------------
select workflow_start(tst.p('third'));
select workflow_start(tst.p('fourth'));
select board_place(tst.p('khione'), 'rotation');
select board_place(tst.p('third'), 'rotation');
select tst.refused(format('select board_place(%s, %L)', tst.p('fourth'), 'rotation'), 'rotation is full at the account''s limit');
select board_place(tst.p('other'), 'rotation');
select tst.expect(rotation_count('J', null) = 2, 'a finished project does not take a rotation slot');
select board_swap(tst.p('fourth'), tst.p('third'));
select tst.expect(tst.place('J', tst.p('fourth')) = 'rotation' and tst.place('J', tst.p('third')) = 'backlog', 'swapping one in and one out');
select tst.refused(format('select board_swap(%s, %s)', tst.p('third'), tst.p('third')), 'swapping out a project not in rotation');
select tst.refused(format('select board_place(%s, %L)', tst.p('third'), 'finished'), 'finished is not a place one sets');
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 0 from board_places where user_id = 'J'), 'another person cannot see one''s board');
select board_place(tst.p('khione'), 'rotation');
select tst.expect(tst.place('G', tst.p('khione')) = 'rotation', 'a viewer puts a shared project on their own board');
select tst.expect(tst.place('J', tst.p('khione')) = 'rotation', 'without moving it on the owner''s');
select tst.refused(format('select board_place(%s, %L)', tst.p('third'), 'backlog'), 'not a project they cannot see');
select tst.affects(format('delete from board_places where project_id = %s', tst.p('khione')), 1, 'one takes a project off one''s own board only');
select tst.expect(workflow_start(tst.p('gordons')) = 'seed', 'an account without a template of its own starts from the default');
select tst.expect((select template_id = tst.default_music() from project_workflow where project_id = tst.p('gordons')), 'recorded as such');

-- Other kinds ------------------------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
select tst.expect(workflow_start(tst.p('album')) = 'select', 'a collection starts from its default at Select');
select tst.expect((select count(*) = 5 from project_stages where project_id = tst.p('album')), 'with its five stages');

reset role;
select 'all 024 tests passed' as result;

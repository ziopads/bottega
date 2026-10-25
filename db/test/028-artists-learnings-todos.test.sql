-- Tests for db/028-artists-learnings-todos.sql: shared artists, templates per
-- artist and who reads and edits them, starting with a chosen template,
-- learnings, and moving items between notes, to-dos and learnings.
--
-- Run once against a fresh scratch database with 001–028 applied, never Neon.
--
--   psql -d bottega_test -f db/test/028-artists-learnings-todos.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status) values
  ('J', 'j@x', 'Person A', 'active'), ('G', 'g@x', 'Person C', 'active'), ('E', 'e@x', 'Person D', 'active'), ('C', 'c@x', 'Person B', 'active')
on conflict (user_id) do nothing;
insert into artists (code, name, account_id) values ('VIG', 'Artist V', 'J'), ('ASU', 'All-Star Underachievers', 'J'),
  ('KWJ', 'Artist K', 'G'), ('EDD', 'Person D', 'E');
insert into projects (kind, title, created_by, owner_id) values
  ('music', 'khione', 'j@x', 'J'), ('music', 'asu one', 'j@x', 'J'), ('music', 'pc asu', 'g@x', 'G'), ('music', 'eddies', 'e@x', 'E');
insert into music_projects (project_id, artist_id, canonical_id)
select p.id, a.id, v.cid from (values ('khione', 'VIG', '2025 0727'), ('asu one', 'ASU', '2025 0801'),
                                      ('pc asu', 'KWJ', '2025 0802'), ('eddies', 'EDD', '2025 0803')) v(t, code, cid)
  join projects p on p.title = v.t join artists a on a.code = v.code;
insert into shares (project_id, grantee_id, level, granted_by) select id, 'C', 'contribute', 'J' from projects where title = 'asu one';
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
create or replace function tst.p(t text) returns bigint language sql security definer as $$ select id from projects where title = t $$;
create or replace function tst.a(c text) returns bigint language sql security definer as $$ select id from artists where code = c $$;
create or replace function tst.wt(n text) returns bigint language sql security definer as $$ select id from workflow_templates where name = n $$;
create or replace function tst.st(n text) returns bigint language sql security definer as $$ select id from structure_templates where name = n $$;
create or replace function tst.wdef() returns bigint language sql security definer as $$ select id from workflow_templates where owner_id is null and kind = 'music' $$;
create or replace function tst.sdef() returns bigint language sql security definer as $$ select id from structure_templates where owner_id is null $$;
create or replace function tst.version(t bigint) returns int language sql security definer as $$ select version from workflow_templates where id = t $$;
create or replace function tst.pw(p bigint) returns project_workflow language sql security definer as $$ select * from project_workflow where project_id = p $$;
create or replace function tst.ps(p bigint) returns project_structure language sql security definer as $$ select * from project_structure where project_id = p $$;
create or replace function tst.note(b text) returns notes language sql security definer as $$ select * from notes where body = b $$;
create or replace function tst.card(w text) returns cards language sql security definer as $$ select * from cards where what = w $$;
create or replace function tst.learning(b text) returns template_learnings language sql security definer as $$ select * from template_learnings where body = b $$;
create or replace function tst.credited(p bigint) returns bigint language sql security definer as $$ select artist_id from music_projects where project_id = p $$;
create or replace function tst.log(a text, k text) returns bigint language sql security definer as $$ select count(*) from access_log where action = a and item_kind = k $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- Sharing an artist -------------------------------------------------------------------------
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 0 from artists where code = 'ASU'), 'Person C does not see ASU before it is shared');
select tst.refused(format($$update music_projects set artist_id = %s where project_id = %s$$, tst.a('ASU'), tst.p('pc asu')),
                   'nor credits his project to it');

select set_config('app.user_id', 'J', false);
select tst.refused(format($$insert into shares (artist_id, grantee_id, level, granted_by) values (%s, 'G', 'contribute', 'J')$$, tst.a('ASU')),
                   'an artist is shared to view or edit, nothing between');
insert into shares (artist_id, grantee_id, level, granted_by) values (tst.a('ASU'), 'G', 'edit', 'J');
select tst.expect(tst.log('share_granted', 'artist') = 1, 'sharing an artist is logged');
select set_config('app.user_id', 'G', false);
select tst.refused(format($$insert into shares (artist_id, grantee_id, level, granted_by) values (%s, 'E', 'view', 'G')$$, tst.a('ASU')),
                   'only the artist''s account shares it on');
select tst.expect((select count(*) = 1 from artists where code = 'ASU'), 'Person C sees ASU once shared');
update music_projects set artist_id = tst.a('ASU') where project_id = tst.p('pc asu');
select tst.expect(tst.credited(tst.p('pc asu')) = tst.a('ASU'), 'and credits his own project to it');
select set_config('app.user_id', 'E', false);
select tst.expect((select count(*) = 0 from artists where code = 'ASU'), 'Person D still does not see ASU');
select tst.refused(format($$update music_projects set artist_id = %s where project_id = %s$$, tst.a('ASU'), tst.p('eddies')),
                   'nor credits to it');

-- Templates per artist ---------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
select template_copy(tst.wdef(), 'ASU club');
select template_copy(tst.wdef(), 'Artist V club');
select structure_copy(tst.sdef(), 'ASU tracks');
select artist_set_templates(tst.a('ASU'), tst.wt('ASU club'), tst.st('ASU tracks'));
select artist_set_templates(tst.a('VIG'), tst.wt('Artist V club'), null);
select tst.expect(project_template(tst.p('asu one')) = tst.wt('ASU club'), 'an ASU project would start from ASU''s template');
select tst.expect(project_structure_template(tst.p('asu one')) = tst.st('ASU tracks'), 'and ASU''s structure');
select tst.expect(project_structure_template(tst.p('khione')) = tst.sdef(), 'an artist with no structure falls back to the account''s');
select tst.expect((select string_agg(label, ',' order by position) from project_stage_list(tst.p('asu one'))) like 'Seed,Palette,%',
                  'stages before the start come from the artist''s template');

select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 1 from workflow_templates where name = 'ASU club'), 'Person C reads ASU''s template');
select tst.expect((select count(*) = 0 from workflow_templates where name = 'Artist V club'), 'never one of Person A''s other templates');
select tst.affects(format($$update template_stages set standard = 'Arranged with Person C' where template_id = %s and key = 'structure'$$, tst.wt('ASU club')),
                   1, 'Person C edits ASU''s template through the artist');
select tst.affects(format($$update structure_elements set description = 'Kicks and hats' where template_id = %s and name = 'TACTUS'$$, tst.st('ASU tracks')),
                   1, 'and its track structure');
select tst.affects(format($$update workflow_templates set name = 'Mine now' where id = %s$$, tst.wt('ASU club')), 0, 'he does not rename it');
select tst.affects(format($$delete from workflow_templates where id = %s$$, tst.wt('ASU club')), 0, 'nor delete it');
select artist_set_templates(tst.a('ASU'), tst.wt('ASU club'), tst.st('ASU tracks'));
select tst.refused(format('select artist_set_templates(%s, %s, null)', tst.a('ASU'), tst.wt('Artist V club')),
                   'he cannot point ASU at a template he cannot read');
select tst.expect(template_copy(tst.wt('ASU club'), 'Artist K club') is not null, 'he can copy ASU''s template into his own account');
select tst.refused(format('select artist_set_templates(%s, null, null)', tst.a('VIG')), 'and cannot set an artist not shared with him');

select set_config('app.user_id', 'E', false);
select tst.expect((select count(*) = 0 from workflow_templates where name = 'ASU club'), 'Person D does not read ASU''s template');
select tst.affects(format($$update template_stages set label = 'X' where template_id = %s$$, tst.wt('ASU club')), 0, 'nor edit it');
select tst.refused(format('select template_copy(%s, %L)', tst.wt('ASU club'), 'Stolen'), 'nor copy it');

-- Starting with the artist's or a chosen template ---------------------------------------------
select set_config('app.user_id', 'J', false);
select workflow_start(tst.p('asu one'));
select tst.expect((tst.pw(tst.p('asu one'))).template_id = tst.wt('ASU club'), 'the old one-argument start uses the artist''s template');
select tst.expect((tst.ps(tst.p('asu one'))).template_id = tst.st('ASU tracks'), 'and the artist''s structure');
select workflow_start_with(tst.p('khione'), tst.wt('ASU club'), tst.sdef());
select tst.expect((tst.pw(tst.p('khione'))).template_id = tst.wt('ASU club'), 'a template can be chosen at the start');
select tst.expect((tst.ps(tst.p('khione'))).template_id = tst.sdef(), 'and a structure');
select set_config('app.user_id', 'G', false);
select tst.refused(format('select workflow_start_with(%s, %s, null)', tst.p('pc asu'), tst.wt('Artist V club')),
                   'never one the person cannot read');
select workflow_start_with(tst.p('pc asu'), null, null);
select tst.expect((tst.pw(tst.p('pc asu'))).template_id = tst.wt('ASU club'), 'Person C''s ASU project starts from ASU''s template');

-- Learnings ----------------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
create temporary table v0 as select tst.version(tst.wt('ASU club')) as v;
select learning_add(tst.p('asu one'), 'structure', 'Rough every section in before naming any.', 'asu one', 'human');
select tst.expect(tst.version(tst.wt('ASU club')) = (select v from v0), 'a learning does not raise the template''s version');
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 1 and bool_and(can_edit and stage = 'structure' and created_by_name = 'Person A')
                     from project_learnings(tst.p('pc asu'))), 'Person C''s ASU project shows it, editable by him');
select learning_add(tst.p('pc asu'), 'structure', 'Check it in mono at low volume.', '', 'human');
select learning_add(tst.p('pc asu'), 'detail', 'Write the outro before the detail pass.', '', 'assistant');
select tst.expect((tst.learning('Write the outro before the detail pass.')).reviewed = false, 'Claude''s learning waits for review');
select tst.affects(format('update template_learnings set reviewed = true where id = %s', (tst.learning('Write the outro before the detail pass.')).id),
                   1, 'and is kept by accepting it');
select tst.refused(format($$insert into template_learnings (stage_id, body, origin, reviewed) values (%s, 'x', 'assistant', false)$$,
                          (tst.learning('Check it in mono at low volume.')).stage_id), 'proposals come only through learning_add');

select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 3 and not bool_or(can_edit) from project_learnings(tst.p('asu one'))),
                  'a contributor sees the project''s learnings but cannot edit them');
select tst.refused(format('select learning_add(%s, %L, %L, %L, %L)', tst.p('asu one'), 'structure', 'x', '', 'human'), 'nor add one');
select set_config('app.user_id', 'E', false);
select tst.expect((select count(*) = 0 from project_learnings(tst.p('asu one'))), 'someone with no access sees none');
select tst.expect((select count(*) = 0 from template_learnings), 'nor reads them directly');

-- Moving items -----------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
insert into notes (project_id, author, body) values (tst.p('asu one'), 'Person A', 'Swing the hats 54%.');
insert into notes (project_id, author, body) values (tst.p('asu one'), 'Person A', 'Pitch the kick and snare up for a two-step feel.');
select set_config('app.user_id', 'C', false);
insert into notes (project_id, author, body) values (tst.p('asu one'), 'Person B', 'Person B hears a click at the drop.');
select tst.refused(format('select note_to_card(%s, null, null, null)', (tst.note('Swing the hats 54%.')).id), 'a contributor cannot move another''s note');
select note_to_card((tst.note('Person B hears a click at the drop.')).id, null, '', 'fix');
select tst.expect((select stage = 'seed' and done_when = 'Not written yet' and status = 'accepted' and created_by = 'C' and kind = 'fix'
                     from tst.card('Person B hears a click at the drop.')), 'his own becomes a to-do in the current stage, his, with done-when unwritten');
select tst.expect(tst.note('Person B hears a click at the drop.') is null, 'and the note is gone');

select set_config('app.user_id', 'J', false);
select note_to_card((tst.note('Swing the hats 54%.')).id, null, 'The hats swing at 54%', null);
select tst.expect((tst.card('Swing the hats 54%.')).done_when = 'The hats swing at 54%', 'done-when can be written while moving');
select card_to_note((tst.card('Swing the hats 54%.')).id);
select tst.expect(((tst.note('Swing the hats 54%.')).author_id = 'J' and (tst.note('Swing the hats 54%.')).author = 'Person A'),
                  'a to-do goes back to a note under its creator');
select tst.expect(tst.card('Swing the hats 54%.') is null, 'and the to-do is gone');
select note_to_learning((tst.note('Pitch the kick and snare up for a two-step feel.')).id, 'palette', null, 'asu one · v4 at 3:30');
select tst.expect((select l.source = 'asu one · v4 at 3:30' and s.key = 'palette'
                     from tst.learning('Pitch the kick and snare up for a two-step feel.') l join template_stages s on s.id = l.stage_id),
                  'a note becomes a learning on the stage chosen, with where it came from');
select tst.expect(tst.note('Pitch the kick and snare up for a two-step feel.') is null, 'and leaves the project');
select card_to_learning((tst.card('Person B hears a click at the drop.')).id, null, 'Listen for clicks at every drop.', '');
select tst.expect((tst.learning('Listen for clicks at every drop.')).id is not null and tst.card('Person B hears a click at the drop.') is null,
                  'a to-do becomes a learning, reworded');

reset role;
insert into cards (project_id, stage, what, done_when, status, settled, settled_reason, settled_at, created_by)
values (tst.p('asu one'), 'seed', 'Keep the 808', '', 'done', true, 'It is the track', now(), 'J');
set role bottega_app;
select set_config('app.user_id', 'J', false);
select tst.refused(format('select card_to_note(%s)', (tst.card('Keep the 808')).id), 'a settled decision does not move');

-- Withdrawing the share ------------------------------------------------------------------------
select set_config('app.user_id', 'G', false);
select template_copy(tst.wt('ASU club'), 'Artist K learned');
select set_config('app.user_id', 'J', false);
delete from shares where artist_id = tst.a('ASU') and grantee_id = 'G';
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 0 from workflow_templates where name = 'ASU club'), 'unshared, Person C no longer reads ASU''s template');
select tst.affects(format($$update template_stages set label = 'X' where template_id = %s$$, tst.wt('ASU club')), 0, 'nor edits it');
select tst.expect(tst.credited(tst.p('pc asu')) = tst.a('ASU'), 'his project stays credited to ASU');
select tst.expect((select count(*) = 5 from template_learnings l join template_stages s on s.id = l.stage_id
                    where s.template_id = tst.wt('Artist K learned')), 'his copy made while shared keeps its learnings');

reset role;
select tst.expect(tst.log('share_revoked', 'artist') = 1, 'withdrawing is logged');
select 'all 028 tests passed' as result;

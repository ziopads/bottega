-- Tests for db/035-default-template-polish.sql: the platform's default music
-- template has Polish after Detail and no Release; a project started from it
-- gets those stages and finishes at Master.
--
-- Run once against a fresh scratch database with 001–035 applied, never Neon.
--
--   psql -d bottega_test -f db/test/035-default-template-polish.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status) values ('J', 'j@x', 'Person A', 'active')
on conflict (user_id) do nothing;
insert into artists (code, name, account_id) values ('VIG', 'Artist V', 'J');
insert into projects (kind, title, created_by, owner_id) values ('music', 'khione', 'j@x', 'J');
insert into music_projects (project_id, artist_id, canonical_id)
select p.id, (select id from artists where code = 'VIG'), '2025 0727' from projects p where p.title = 'khione';
select set_config('app.actor', '', false);

create schema if not exists tst; grant usage on schema tst to bottega_app;
create or replace function tst.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.p(t text) returns bigint language sql security definer as $$ select id from projects where title = t $$;
create or replace function tst.stage(p bigint) returns text language sql security definer as $$ select stage from project_workflow where project_id = p $$;
create or replace function tst.finished(p bigint) returns boolean language sql security definer as $$ select finished_at is not null from project_workflow where project_id = p $$;
create or replace function tst.default_id(k text) returns bigint language sql security definer as $$ select id from workflow_templates where owner_id is null and kind = k $$;
create or replace function tst.stages(t bigint) returns text language sql security definer as $$ select string_agg(key, ',' order by position) from template_stages where template_id = t $$;
create or replace function tst.bodies(t bigint, k text) returns text language sql security definer as $$
  select string_agg(tc.body, ' | ' order by tc.position) from template_criteria tc join template_stages ts on ts.id = tc.stage_id where ts.template_id = t and ts.key = k $$;
create or replace function tst.n(t bigint, k text) returns bigint language sql security definer as $$
  select count(*) from template_criteria tc join template_stages ts on ts.id = tc.stage_id where ts.template_id = t and ts.key = k $$;
grant execute on all functions in schema tst to bottega_app;

-- The default -----------------------------------------------------------------------------------
select tst.expect(tst.stages(tst.default_id('music')) = 'seed,palette,structure,detail,polish,mixdown,master', 'the music default: Polish after Detail, no Release');
select tst.expect(tst.stages(tst.default_id('collection')) = 'select,sequence,master,artwork,release', 'the collection default keeps its Release stage');
select tst.expect((select array_agg(position order by position) from template_stages where template_id = tst.default_id('music')) = array[1,2,3,4,5,6,7], 'positions run 1 to 7 with no gap');
select tst.expect((select standard from template_stages where template_id = tst.default_id('music') and key = 'detail') = 'Refining and improving what''s there', 'Detail''s new standard');
select tst.expect((select label || ': ' || standard from template_stages where template_id = tst.default_id('music') and key = 'polish') = 'Polish: Add polishing effects to each track', 'Polish and its standard');
select tst.expect((select standard from template_stages where template_id = tst.default_id('music') and key = 'mixdown') = 'Translates everywhere', 'Mixdown''s standard is as it was');

-- Criteria ---------------------------------------------------------------------------------------
select tst.expect(tst.bodies(tst.default_id('music'), 'detail') =
  'Drop 2 differs from drop 1 | Other percussion chosen and tuned | Check for any tracks where groove/note tweaks are needed | Transitions built | Automation pass | Ear candy and vocals placed | A fresh-ears listen after a day away',
  'Detail: seven criteria, Other percussion second, the groove one third');
select tst.expect((select check_key from template_criteria tc join template_stages ts on ts.id = tc.stage_id
                    where ts.template_id = tst.default_id('music') and ts.key = 'detail' and tc.body = 'Automation pass') = 'automation', 'Automation pass keeps its check');
select tst.expect(tst.n(tst.default_id('music'), 'polish') = 6, 'Polish has six criteria');
select tst.expect((select hint from template_criteria tc join template_stages ts on ts.id = tc.stage_id
                    where ts.template_id = tst.default_id('music') and ts.key = 'polish' and tc.position = 6) = 'Bounce to mp3, try on different systems', 'a Polish hint');
select tst.expect(tst.bodies(tst.default_id('music'), 'mixdown') =
  'Kick and sub relationship resolved, low end mono below 120 Hz | Panning pass | Gain staged, master left clean | Bounced and heard on small speakers, laptop, headphones and car',
  'Mixdown: the kick/sub and low end criteria are one, and Panning pass comes before Gain staged');
select tst.expect((select check_key from template_criteria tc join template_stages ts on ts.id = tc.stage_id
                    where ts.template_id = tst.default_id('music') and ts.key = 'mixdown' and tc.body = 'Gain staged, master left clean') = 'master_clean', 'Mixdown keeps its master-clean check');
select tst.expect(tst.n(tst.default_id('music'), 'master') = 4, 'Master is as it was');
select tst.expect(not exists (select 1 from template_criteria tc join template_stages ts on ts.id = tc.stage_id
                               where ts.template_id = tst.default_id('music') and tc.body in ('Collaborator sign-off', 'Promo copies sent to DJs')), 'Release''s criteria are gone from the music default');

-- A project started from it --------------------------------------------------------------------------
set role bottega_app;
select set_config('app.user_id', 'J', false);
select workflow_start(tst.p('khione'));
select tst.expect((select string_agg(key, ',' order by position) from project_stages where project_id = tst.p('khione')) = 'seed,palette,structure,detail,polish,mixdown,master', 'a new project gets the new stages');
select tst.expect((select count(*) from exit_criteria where project_id = tst.p('khione')) = 4 + 5 + 4 + 7 + 6 + 4 + 4, 'and all 34 criteria');

-- And moves through them (034) ------------------------------------------------------------------------
update exit_criteria set met_at = now() where project_id = tst.p('khione') and stage in ('seed', 'palette', 'structure', 'detail');
select tst.expect(tst.stage(tst.p('khione')) = 'polish', 'Detail complete: the project is in Polish');
update exit_criteria set met_at = now() where project_id = tst.p('khione') and stage in ('polish', 'mixdown');
select tst.expect(tst.stage(tst.p('khione')) = 'master' and not tst.finished(tst.p('khione')), 'Mixdown complete: in Master, not finished');
update exit_criteria set met_at = now() where project_id = tst.p('khione');
select tst.expect(tst.stage(tst.p('khione')) = 'master' and tst.finished(tst.p('khione')), 'Master complete: finished');

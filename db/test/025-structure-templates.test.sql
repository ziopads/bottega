-- Tests for db/025-structure-templates.sql: the default structure, matchers,
-- copies and their privacy, the preference, copying into a project when its
-- workflow starts, the zones a project's sets are read with, and bringing in
-- template changes.
--
-- Run once against a fresh scratch database with 001–025 applied, never Neon.
--
--   psql -d bottega_test -f db/test/025-structure-templates.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('E', 'e@x', 'Eddie', 'active', false),
  ('C', 'c@x', 'Chris', 'active', false), ('G', 'g@x', 'Gordon', 'active', false),
  ('O', 'o@x', 'Other', 'active', false)
on conflict (user_id) do nothing;
insert into projects (kind, title, created_by, owner_id) values
  ('music', 'khione', 'j@x', 'J'), ('music', 'gordons', 'g@x', 'G'), ('collection', 'album', 'j@x', 'J');
insert into shares (project_id, grantee_id, level, granted_by) select id, 'E', 'edit', 'J' from projects where title = 'khione';
insert into shares (project_id, grantee_id, level, granted_by) select id, 'C', 'contribute', 'J' from projects where title = 'khione';
insert into shares (project_id, grantee_id, level, granted_by) select id, 'G', 'view', 'J' from projects where title = 'khione';
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
create or replace function tst.def() returns bigint language sql security definer as $$ select id from structure_templates where owner_id is null $$;
create or replace function tst.mine(n text) returns bigint language sql security definer as $$ select id from structure_templates where name = n and owner_id is not null $$;
create or replace function tst.el(t bigint, n text) returns bigint language sql security definer as
  $$ select id from structure_elements where template_id = t and name = n $$;
create or replace function tst.version(t bigint) returns int language sql security definer as $$ select version from structure_templates where id = t $$;
create or replace function tst.pel(p bigint, n text) returns elements language sql security definer as
  $$ select * from elements where project_id = p and name = n $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- The default ------------------------------------------------------------------------------
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 8 from structure_elements where template_id = tst.def() and parent_id is null),
                  'every account reads the default: eight top-level elements');
select tst.expect((select string_agg(name, ',' order by position) from structure_elements where template_id = tst.def() and is_zone)
                  = 'TACTUS,BASS,BACKGROUND,LEADS,TEXTURE,VOX', 'six of them zones, in the Live template''s order');
select tst.expect((select prefixes = '{TAC}' and color in ('#b5543c', '#e34948') from structure_elements where template_id = tst.def() and name = 'TACTUS'),
                  'TACTUS matches TAC and keeps its colour');
select tst.expect((select count(*) = 23 from structure_elements where template_id = tst.def() and parent_id is not null), 'with 23 parts');
select tst.affects(format($$update structure_elements set name = 'X' where id = %s$$, tst.el(tst.def(), 'BASS')),
                   0, 'nobody edits the default');

-- Copies --------------------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
select tst.expect(structure_copy(tst.def(), 'Sirsinate') is not null, 'an account copies the default');
select tst.expect((select count(*) = 31 from structure_elements e join structure_elements d on d.uid = e.uid and d.template_id = tst.def()
                    where e.template_id = tst.mine('Sirsinate')), 'every element comes, keeping its uid');
select tst.expect((select count(*) = 23 from structure_elements c join structure_elements p on p.id = c.parent_id
                    where c.template_id = tst.mine('Sirsinate') and p.template_id = tst.mine('Sirsinate')), 'parts under the copy''s own zones');
select tst.expect(tst.version(tst.mine('Sirsinate')) = 1, 'at version 1');
select tst.affects(format($$update structure_elements set name = 'PULSE', prefixes = '{TAC,DRM}', group_names = '{Drums}' where id = %s$$,
                          tst.el(tst.mine('Sirsinate'), 'TACTUS')), 1, 'the owner renames a zone and adds a prefix and a group name');
select tst.expect(tst.version(tst.mine('Sirsinate')) > 1, 'which raises the version');
select tst.refused(format($$update structure_elements set prefixes = '{TAC,tac}' where id = %s$$, tst.el(tst.mine('Sirsinate'), 'PULSE')),
                   'no prefix twice, whatever the case');
select tst.refused(format($$update structure_elements set prefixes = '{" TAC"}' where id = %s$$, tst.el(tst.mine('Sirsinate'), 'PULSE')),
                   'no spaces around a prefix');
select tst.refused(format($$update structure_elements set prefixes = '{BUS}' where id = %s$$, tst.el(tst.mine('Sirsinate'), 'BUS')),
                   'an element that is no zone matches nothing');
select tst.refused(format($$update structure_elements set is_zone = true where id = %s$$, tst.el(tst.mine('Sirsinate'), 'Kick')),
                   'a part is no zone');
select tst.refused(format($$insert into structure_elements (template_id, parent_id, name) values (%s, %s, 'x')$$,
                          tst.mine('Sirsinate'), tst.el(tst.mine('Sirsinate'), 'Kick')), 'parts sit under top-level elements only');
select tst.refused(format($$insert into structure_elements (template_id, parent_id, name) values (%s, %s, 'x')$$,
                          tst.mine('Sirsinate'), tst.el(tst.def(), 'BASS')), 'and under their own template''s');
select tst.refused($$select structure_copy(tst.def(), 'Sirsinate')$$, 'one name per account');

select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 0 from structure_templates where owner_id = 'J'), 'another account cannot see the copy');
select tst.refused(format('select structure_copy(%s, %L)', tst.mine('Sirsinate'), 'Mine'), 'nor copy it');
select tst.refused(format('insert into account_preferences (structure_template_id) values (%s)', tst.mine('Sirsinate')), 'nor choose it');

select set_config('app.user_id', 'J', false);
insert into account_preferences (structure_template_id) values (tst.mine('Sirsinate'));
select tst.expect(account_structure('J') = tst.mine('Sirsinate') and account_structure('G') = tst.def(), 'each account''s structure, the default by default');

-- Before and after the start -----------------------------------------------------------------
select tst.expect((select string_agg(name, ',' order by position) from project_zones(tst.p('khione'))) = 'PULSE,BASS,BACKGROUND,LEADS,TEXTURE,VOX',
                  'before its workflow starts, a project is read with its owner''s structure');
select set_config('app.user_id', 'C', false);
select tst.refused(format('select structure_start(%s)', tst.p('khione')), 'a contributor cannot start the structure');
select set_config('app.user_id', 'E', false);
select workflow_start(tst.p('khione'));
select tst.expect((select count(*) = 31 from elements where project_id = tst.p('khione')), 'starting the workflow copies the owner''s structure');
select tst.expect(((tst.pel(tst.p('khione'), 'PULSE')).prefixes = '{TAC,DRM}' and (tst.pel(tst.p('khione'), 'PULSE')).group_names = '{Drums}'
                   and (tst.pel(tst.p('khione'), 'PULSE')).is_zone), 'with its zones and matchers');
select tst.expect((select count(*) = 23 from elements c join elements p on p.id = c.parent_id where c.project_id = tst.p('khione')),
                  'and its parts under them');
select tst.expect((select template_id = tst.mine('Sirsinate') and template_version = tst.version(tst.mine('Sirsinate'))
                     from project_structure where project_id = tst.p('khione')), 'the template and version are recorded');
select tst.expect(structure_start(tst.p('khione')) = 0, 'starting again copies nothing');
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 6 from project_zones(tst.p('khione'))), 'a viewer reads the project''s zones');
select set_config('app.user_id', 'O', false);
select tst.expect((select count(*) = 0 from project_zones(tst.p('khione'))), 'someone without access reads none');

-- Template changes ------------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
update structure_elements set name = 'TACTUS', color = '#aa0000' where id = tst.el(tst.mine('Sirsinate'), 'PULSE');
insert into structure_elements (template_id, parent_id, position, name) values (tst.mine('Sirsinate'), tst.el(tst.mine('Sirsinate'), 'BASS'), 3, 'Reese');
select tst.expect(((tst.pel(tst.p('khione'), 'PULSE')).id is not null), 'a template change does not reach a project underway');
select set_config('app.user_id', 'E', false);
insert into cards (project_id, element_id, stage, what, done_when) values (tst.p('khione'), (tst.pel(tst.p('khione'), 'PULSE')).id, 'seed', 'Tune the kick', 'In key');
select set_config('app.user_id', 'G', false);
select tst.expect((select version > seen_version from structure_template_status(tst.p('khione'))), 'a viewer sees the structure has moved on');
select tst.expect((select count(*) = 32 from structure_template_elements(tst.p('khione'))), 'and reads the template''s elements');
select set_config('app.user_id', 'C', false);
select tst.refused(format('select structure_apply(%s, %L::uuid[])', tst.p('khione'), '{}'), 'a contributor cannot bring changes in');
select set_config('app.user_id', 'E', false);
select tst.expect(structure_apply(tst.p('khione'),
                    array(select uid from structure_template_elements(tst.p('khione')) where name in ('TACTUS', 'Reese'))) = 2,
                  'an editor brings in a renamed zone and a new part');
select tst.expect(((tst.pel(tst.p('khione'), 'TACTUS')).color in ('#aa0000', '#e34948')), 'the zone takes the new name and colour');
select tst.expect((select count(*) = 1 from cards c join elements e on e.id = c.element_id where e.name = 'TACTUS' and c.project_id = tst.p('khione')),
                  'its cards stay on it');
select tst.expect((select p.name = 'BASS' from elements c join elements p on p.id = c.parent_id where c.project_id = tst.p('khione') and c.name = 'Reese'),
                  'the new part lands under its zone');
select tst.expect((select version = seen_version from structure_template_status(tst.p('khione'))), 'the version is marked seen');
select tst.expect(structure_apply(tst.p('khione'), array(select uid from structure_template_elements(tst.p('khione')) where name = 'Reese')) = 0,
                  'bringing it in twice adds nothing');

-- Other owners and kinds ------------------------------------------------------------------------------
select set_config('app.user_id', 'G', false);
select workflow_start(tst.p('gordons'));
select tst.expect(((tst.pel(tst.p('gordons'), 'TACTUS')).prefixes = '{TAC}'), 'an account without a structure of its own takes the default');
select set_config('app.user_id', 'J', false);
select workflow_start(tst.p('album'));
select tst.expect((select count(*) = 0 from elements where project_id = tst.p('album')), 'a collection takes no track structure');

reset role;
select 'all 025 tests passed' as result;

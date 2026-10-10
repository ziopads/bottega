-- Tests for db/002-accounts.sql: account isolation, sharing levels, collection
-- inheritance, owner-only deletes, the administrator's read-only view, and the
-- access log. 43 checks; each raises on failure.
--
-- Run against a scratch database, never Neon: it inserts test accounts.
--
--   createdb bottega_test
--   psql -d bottega_test -c 'create role bottega_app login'   # once per server
--   psql -d bottega_test -f db/001-foundation.sql -f db/002-accounts.sql
--   psql -d bottega_test -f db/test/002-accounts.test.sql
--
-- Not a migration: pipeline/migrate.py reads only db/[0-9]*.sql.
\set ON_ERROR_STOP 1
\set QUIET 1

-- Seed, as the owner ----------------------------------------------------------
select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true),
  ('C', 'c@x', 'Chris', 'active', false),
  ('G', 'g@x', 'Gordon', 'active', false);
insert into artists (code, name, account_id) values ('VIG', 'Vigorish', 'J'), ('KR', 'Kamikaze Rabbit', 'C'), ('KJI', 'Kawaji', 'G');
insert into genres values ('House');
-- James: p1, p2 (music), c1 (collection of p1, p2)
insert into projects (kind, title, created_by, owner_id) values
  ('music', 'p1', 'j@x', 'J'), ('music', 'p2', 'j@x', 'J'), ('collection', 'c1', 'j@x', 'J'), ('music', 'p3', 'c@x', 'C');
insert into music_projects (project_id, artist_id, canonical_id)
  select id, (select id from artists where code = 'VIG'), title from projects where title in ('p1', 'p2');
insert into music_projects (project_id, artist_id, canonical_id)
  select id, (select id from artists where code = 'KR'), title from projects where title = 'p3';
insert into collections (project_id, form) select id, 'ep' from projects where title = 'c1';
insert into project_parts select (select id from projects where title = 'c1'), id, row_number() over (order by id) from projects where title in ('p1', 'p2');
insert into audio (project_id, role, version, r2_key, original_filename, uploaded_by, uploaded_by_id)
  select id, 'mix', 1, 'k-' || title, title || '.mp3', 'j@x', 'J' from projects where title in ('p1', 'p2');
select set_config('app.actor', '', false);

create schema if not exists tst; grant usage on schema tst to bottega_app;
create or replace function tst.id(t text) returns bigint language sql as $$ select id from projects where title = t $$;
create or replace function tst.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
-- pg_temp functions belong to the session, so grant use to the app role.
create schema if not exists tst; grant usage on schema tst to bottega_app;

set role bottega_app;

-- Nobody set: nothing visible ------------------------------------------------------
select tst.expect((select count(*) from projects) = 0, 'no person: no projects');
select tst.expect((select count(*) from accounts) = 0, 'no person: no accounts');

-- Chris sees only his own -----------------------------------------------------------
select set_config('app.user_id', 'C', false);
select tst.expect((select array_agg(title order by title) from projects) = array['p3'], 'Chris sees only p3');
select tst.expect((select count(*) from audio) = 0, 'Chris sees no audio of James');
select tst.expect((select array_agg(code) from artists) = array['KR'], 'Chris sees only his artist');

-- Gordon sees only his own (nothing yet)
select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) from projects) = 0, 'Gordon sees nothing of James or Chris');

-- Pending person ------------------------------------------------------------------------
select set_config('app.user_id', 'P', false);
select tst.expect((select status from register_session('p@x', 'Pat')) = 'pending', 'new sign-up is pending');
select tst.expect((select count(*) from projects) = 0, 'pending sees nothing');
select tst.expect((select count(*) from genres) = 0, 'pending sees no genres');

-- James shares c1 with Gordon (view) and p2 with Chris (contribute) -------------------
select set_config('app.user_id', 'J', false);
insert into shares (project_id, grantee_id, level) values (tst.id('c1'), 'G', 'view'), (tst.id('p2'), 'C', 'contribute');

select set_config('app.user_id', 'G', false);
select tst.expect((select array_agg(title order by title) from projects) = array['c1', 'p1', 'p2'], 'Gordon sees c1 and its parts (AC-6)');
select tst.expect(project_level(tst.id('p1')) = 'view', 'Gordon has view on p1 through c1');
select tst.expect((select count(*) from audio) = 2, 'Gordon hears the parts');
do $$ begin
  insert into notes (project_id, author, body) values (tst.id('p1'), 'g@x', 'hi');
  raise exception 'FAILED: viewer could add a note';
exception when insufficient_privilege then raise notice 'ok: viewer cannot add a note';
end $$;
update projects set title = 'hacked' where id = tst.id('p1');
select set_config('app.user_id', 'J', false);
select tst.expect((select title from projects where id = tst.id('p1')) = 'p1', 'viewer update changed nothing');

-- Chris contributes to p2 ---------------------------------------------------------------
select set_config('app.user_id', 'C', false);
select tst.expect((select array_agg(title order by title) from projects) = array['p2', 'p3'], 'Chris sees p2 (shared) and p3, not p1 or c1');
insert into notes (project_id, author, body) values (tst.id('p2'), 'c@x', 'nice');
insert into audio (project_id, role, version, r2_key, original_filename, uploaded_by)
  values (tst.id('p2'), 'mix', 2, 'k-p2-v2', 'p2v2.mp3', 'c@x');
select tst.expect((select author_id from notes where body = 'nice') = 'C', 'note author is Chris by default');
update projects set title = 'renamed' where id = tst.id('p2');  -- contribute cannot edit fields
delete from audio where project_id = tst.id('p2');              -- nor delete
delete from notes where body = 'nice';                              -- nor delete his own note
select tst.expect((select count(*) from notes where body = 'nice') = 1, 'collaborator cannot delete own note');
update notes set body = 'nicer' where body = 'nice';
select tst.expect((select count(*) from notes where body = 'nicer') = 1, 'collaborator edits own note');
do $$ begin
  update audio set r2_key = 'evil' where project_id = tst.id('p2');
  raise exception 'FAILED: storage key updatable';
exception when insufficient_privilege then raise notice 'ok: storage key not updatable';
end $$;
do $$ begin
  update projects set owner_id = 'C' where id = tst.id('p2');
  raise exception 'FAILED: owner changeable';
exception when insufficient_privilege then raise notice 'ok: owner not changeable';
end $$;
-- Chris cannot share James's item onward
do $$ begin
  insert into shares (project_id, grantee_id, level) values (tst.id('p2'), 'G', 'view');
  raise exception 'FAILED: non-owner could share';
exception when insufficient_privilege then raise notice 'ok: non-owner cannot share';
end $$;

select set_config('app.user_id', 'J', false);
select tst.expect((select count(*) from audio where project_id = tst.id('p2')) = 2, 'collaborator deleted no audio');
select tst.expect((select title from projects where id = tst.id('p2')) = 'p2', 'contributor could not rename');

-- Edit level --------------------------------------------------------------------------------
update shares set level = 'edit' where project_id = tst.id('p2') and grantee_id = 'C';
select set_config('app.user_id', 'C', false);
update projects set title = 'renamed' where id = tst.id('p2');
select tst.expect((select title from projects where id = tst.id('p2')) = 'renamed', 'editor renames');
do $$ begin
  update music_projects set artist_id = (select id from artists where code = 'KR') where project_id = tst.id('p2');
  raise exception 'FAILED: credited own artist on James project';
exception when raise_exception then raise notice 'ok: cannot credit another account''s artist';
end $$;

-- Creating a project: one statement, as lib/studio.ts does -------------------------------------
select set_config('app.user_id', 'C', false);
with p as (insert into projects (kind, title, created_by) values ('music', 'p4', 'c@x') returning id),
     m as (insert into music_projects (project_id, artist_id, canonical_id)
           select id, (select id from artists where code = 'KR'), '2026 1010' from p)
select id from p;
select tst.expect((select owner_id from projects where title = 'p4') = 'C', 'new project owned by its creator');
reset role;
insert into projects (kind, title, created_by, owner_id) values ('music', 'bare', 'j@x', 'J');
select set_config('tst.bare', (select id from projects where title = 'bare')::text, false);
set role bottega_app;
do $$ begin
  insert into music_projects (project_id, artist_id, canonical_id)
    values (current_setting('tst.bare')::bigint, 1, 'x');
  raise exception 'FAILED: kind row on another project';
exception when others then raise notice 'ok: kind row on another''s project refused (%)', sqlerrm;
end $$;

-- Owner deletes; cascade logs the share --------------------------------------------------------
select set_config('app.user_id', 'J', false);
delete from projects where id = tst.id('p1');
select tst.expect(tst.id('p1') is null, 'owner deletes');

-- Collections pass on only their owner's tracks ----------------------------------------------
-- James puts Chris's p3? He cannot see it, so cannot add it.
do $$ begin
  insert into project_parts values (tst.id('c1'), (select id from projects where title = 'p3'), 9);
  raise exception 'FAILED: added an invisible project to a collection';
exception when others then raise notice 'ok: cannot add unseen project (%)', sqlerrm;
end $$;

-- Admin read-only view ---------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
select tst.expect((select count(*) from projects where title = 'p3') = 0, 'admin without admin_view sees only own');
select set_config('app.admin_view', 'on', false);
select tst.expect((select count(*) from projects where title = 'p3') = 1, 'admin_view sees Chris''s p3');
update projects set title = 'x' where title = 'p3';
select set_config('app.admin_view', '', false);
reset role;
select tst.expect((select count(*) from projects where title = 'p3') = 1, 'admin_view changed nothing');
set role bottega_app;
select set_config('app.user_id', 'C', false);
select set_config('app.admin_view', 'on', false);
select tst.expect((select count(*) from projects where owner_id = 'J') = 1, 'non-admin admin_view gains nothing (only p2 shared)');
select set_config('app.admin_view', '', false);

-- Accounts: admin approves, logged; last admin protected ---------------------------------
select set_config('app.user_id', 'J', false);
select admin_set_account('P', 'active', false, 'known to James');
do $$ begin
  perform admin_set_account('J', 'active', false, null);
  raise exception 'FAILED: removed last admin';
exception when raise_exception then raise notice 'ok: last admin protected (%)', sqlerrm;
end $$;
select set_config('app.user_id', 'C', false);
do $$ begin
  perform admin_set_account('C', 'active', true, null);
  raise exception 'FAILED: non-admin promoted self';
exception when raise_exception then raise notice 'ok: non-admin cannot change accounts';
end $$;
do $$ begin
  insert into access_log (actor, action) values ('C', 'forged');
  raise exception 'FAILED: forged log entry';
exception when insufficient_privilege then raise notice 'ok: app cannot write the log directly';
end $$;
do $$ begin
  perform log_event('share_granted', null, null, null, null);
  raise exception 'FAILED: log_event accepted arbitrary action';
exception when raise_exception then raise notice 'ok: log_event action list closed';
end $$;
select log_event('password_changed', null, null, null, null);
select tst.expect((select count(*) from accounts) = 1, 'Chris reads only his own account row');
select tst.expect(not exists (select 1 from access_log where subject_id = 'P'), 'Chris does not see others'' log entries');

-- Transaction-local setting does not leak --------------------------------------------------
reset role;
select set_config('app.user_id', '', false);
set role bottega_app;
begin;
select set_config('app.user_id', 'J', true);
select tst.expect((select count(*) from projects) > 0, 'inside the transaction James sees his projects');
commit;
select tst.expect(app_user() is null, 'after commit nobody is set');
select tst.expect((select count(*) from projects) = 0, 'after commit nothing visible');

-- The log --------------------------------------------------------------------------------
reset role;
do $$ begin
  update access_log set reason = 'x';
  raise exception 'FAILED: log updated';
exception when raise_exception then raise notice 'ok: log cannot be updated, even by the owner';
end $$;
\echo
\echo access_log:
select actor, action, subject_id, item_kind, item_id, before, after, reason from access_log order by id;

-- Tests for db/010-account-settings.sql: changing one's own display name,
-- account preferences, and the reads the account page makes (its own artists,
-- outgoing and incoming shares, its activity, its largest files).
--
-- Run once against a fresh scratch database with 001–010 applied, never Neon.
--
--   psql -d bottega_test -f db/test/010-account-settings.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('C', 'c@x', 'Chris', 'active', false),
  ('G', 'g@x', 'Gordon', 'active', false), ('P', 'p@x', '', 'pending', false)
on conflict (user_id) do nothing;
insert into artists (code, name, account_id) values ('SIR', 'Sirsinate', 'J'), ('ALT', 'Alter', 'J'), ('CHR', 'Chris Music', 'C');
insert into projects (kind, title, created_by, owner_id) values ('music', 'khione', 'j@x', 'J');
insert into music_projects (project_id, canonical_id, artist_id)
  select p.id, 'SIR-001', a.id from projects p, artists a where p.title = 'khione' and a.code = 'SIR';
insert into audio (project_id, role, version, r2_key, original_filename, bytes, uploaded_by, uploaded_by_id)
  select id, 'mix', v, 'k-khione-' || v, 'khione v' || v || '.wav', v * 1000, 'j@x', 'J'
  from projects, generate_series(1, 3) v where title = 'khione';
insert into shares (project_id, grantee_id, level, granted_by)
  select id, 'C', 'contribute', 'J' from projects where title = 'khione';
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

-- Display name ------------------------------------------------------------------------
select set_config('app.user_id', 'C', false);
select tst.expect(set_my_display_name('  Chris Alvarez ') = 'Chris Alvarez', 'a person sets their own display name, trimmed');
select tst.expect((select display_name from accounts where user_id = 'C') = 'Chris Alvarez', 'the new name is stored');
select tst.expect((select count(*) = 1 from access_log where action = 'display_name_changed' and subject_id = 'C'
                   and before->>'display_name' = 'Chris' and after->>'display_name' = 'Chris Alvarez'),
                  'the change is in the access log with before and after');
select set_my_display_name('Chris Alvarez');
select tst.expect((select count(*) = 1 from access_log where action = 'display_name_changed' and subject_id = 'C'),
                  'setting the same name again logs nothing');
select tst.refused($$select set_my_display_name('   ')$$, 'an empty display name');
select tst.refused($$select set_my_display_name(repeat('x', 81))$$, 'a display name over 80 characters');
select tst.refused($$update accounts set display_name = 'Mallory' where user_id = 'C'$$, 'a direct update of accounts');
select * from register_session('c@x', 'Someone Else');
select tst.expect((select display_name from accounts where user_id = 'C') = 'Chris Alvarez', 'signing in again keeps the chosen name');
select set_config('app.user_id', 'P', false);
select tst.refused($$select set_my_display_name('Pat')$$, 'a pending account cannot set a name');
select set_config('app.user_id', '', false);
select tst.refused($$select set_my_display_name('Nobody')$$, 'no person, no name');

-- Preferences -------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
select tst.affects($$insert into account_preferences (default_artist_id) select id from artists where code = 'ALT'$$, 1,
                   'a person stores a default artist of their own');
select tst.expect((select user_id = 'J' from account_preferences), 'the row is theirs by default');
select tst.refused($$insert into account_preferences (user_id) values ('J')$$, 'a second row for the same account');
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 0 from account_preferences), 'another account sees no one else''s preferences');
select tst.affects($$update account_preferences set default_artist_id = null$$, 0, 'nor changes them');
select tst.refused($$insert into account_preferences (user_id) values ('G')$$, 'a row for someone else');
select tst.refused($$insert into account_preferences (default_artist_id) values ((select id from artists where code = 'CHR') - 1000000)$$,
                   'an artist that does not exist');
reset role;
create or replace function tst.artist(c text) returns bigint language sql security definer as $$ select id from artists where code = c $$;
grant execute on function tst.artist(text) to bottega_app;
set role bottega_app;
select set_config('app.user_id', 'C', false);
select tst.refused(format('insert into account_preferences (default_artist_id) values (%s)', tst.artist('SIR')),
                   'another account''s artist as the default');
select tst.affects(format('insert into account_preferences (default_artist_id) values (%s)', tst.artist('CHR')), 1,
                   'Chris stores his own artist');
select set_config('app.user_id', 'J', false);
select tst.refused(format('update account_preferences set default_artist_id = %s', tst.artist('CHR')),
                   'changing the default to someone else''s artist');
select tst.affects(format('update account_preferences set default_artist_id = %s', tst.artist('SIR')), 1,
                   'changing the default to another of one''s own');
select tst.refused($$update account_preferences set user_id = 'C'$$, 'moving the row to another account');
select tst.affects($$delete from artists where code = 'ALT'$$, 1, 'an artist no session uses can be deleted');
select tst.refused($$delete from artists where code = 'SIR'$$, 'an artist credited on a session cannot be deleted');
select tst.affects(format('update account_preferences set default_artist_id = %s', tst.artist('SIR')), 1, 'reset');
reset role;
-- Deleting the default artist clears the preference (as the owner: the
-- session using it is moved first).
insert into artists (code, name, account_id) values ('TMP', 'Temporary', 'J');
update account_preferences set default_artist_id = tst.artist('TMP') where user_id = 'J';
delete from artists where code = 'TMP';
select tst.expect((select default_artist_id is null from account_preferences where user_id = 'J'),
                  'deleting the default artist clears the preference');
set role bottega_app;

-- Artists -----------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
select tst.affects($$update artists set name = 'Sirsinate Studio' where code = 'SIR'$$, 1, 'renaming one''s own artist');
select tst.affects($$update artists set name = 'Taken' where code = 'CHR'$$, 0, 'not someone else''s');
select tst.refused($$insert into artists (code, name) values ('CHR', 'Copy')$$, 'a code already in use');
select tst.refused($$insert into artists (code, name, account_id) values ('NEW', 'New', 'C')$$, 'an artist for someone else');

-- What the account page reads -----------------------------------------------------------
select tst.expect((select count(*) = 1 from shares s join projects p on p.id = s.project_id where p.owner_id = app_user()),
                  'the owner lists the shares they granted');
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 1 from shares where grantee_id = app_user()), 'the grantee lists what is shared with them');
select tst.expect((select count(*) = 0 from shares s join projects p on p.id = s.project_id where p.owner_id = app_user()),
                  'and has granted nothing');
select tst.expect((select count(*) >= 2 from access_log where actor = app_user() or subject_id = app_user()),
                  'a person reads their own activity');
select tst.expect((select count(*) = 0 from access_log where action = 'display_name_changed' and subject_id = 'J'),
                  'and not another person''s');
select set_config('app.user_id', 'J', false);
select tst.expect((select array_agg(a.bytes order by a.bytes desc) = '{3000,2000,1000}'
                   from audio a join projects p on p.id = a.project_id where p.owner_id = app_user()),
                  'the owner lists their audio by size');
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 0 from audio a join projects p on p.id = a.project_id where p.owner_id = app_user()),
                  'a collaborator''s largest files exclude what is only shared with them');

reset role;
select 'all 010 tests passed' as result;

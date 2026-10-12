-- Tests for db/017-study-sessions.sql: study sessions and notes, Claude's
-- drafts and publishing, private entries, and who may change what.
--
-- Run once against a fresh scratch database with 001–017 applied, never Neon.
--
--   psql -d bottega_test -f db/test/017-study-sessions.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('C', 'c@x', 'Chris', 'active', false), ('O', 'o@x', 'Outsider', 'active', false)
on conflict (user_id) do nothing;
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
  execute stmt; get diagnostics got = row_count;
  if got <> n then raise exception 'FAILED: % (changed %, expected %)', what, got, n; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.g() returns bigint language sql security definer as $$ select id from study_groups where name = 'MPC study' $$;
create or replace function tst.topic(t text) returns bigint language sql security definer as $$ select id from study_topics where title = t $$;
create or replace function tst.s(t text) returns bigint language sql security definer as $$ select id from study_sessions where summary = t $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- A group with Chris in it, and two topics.
select set_config('app.user_id', 'J', false);
insert into study_groups (name) values ('MPC study');
insert into study_topics (group_id, title) values (tst.g(), 'Sampling'), (tst.g(), 'Programs');
select study_group_invite(tst.g(), 'c@x');
select set_config('app.user_id', 'C', false);
select study_invitation_answer((select id from study_group_invitations where account_id = 'C'), true);
insert into study_groups (name) values ('Other group');
insert into study_topics (group_id, title) values ((select id from study_groups where name = 'Other group'), 'Elsewhere');

-- A member logs a session in the app: published at once.
select set_config('app.user_id', 'J', false);
insert into study_sessions (group_id, minutes, kind, summary) values (tst.g(), 45, 'at the instrument', 'Chopped a break');
select tst.expect((select published and author_id = 'J' from study_sessions where id = tst.s('Chopped a break')),
  'a session written in the app is published, in its author''s name');
insert into study_session_topics values (tst.s('Chopped a break'), tst.topic('Sampling'));
select tst.refused($$insert into study_session_topics values (tst.s('Chopped a break'), tst.topic('Elsewhere'))$$,
  'a topic from another group');
insert into study_notes (group_id, session_id, topic_id, body) values (tst.g(), tst.s('Chopped a break'), tst.topic('Sampling'), 'Pad 9 clicks');

-- Claude documents a conversation: a draft only its author sees.
insert into study_sessions (group_id, minutes, kind, summary, origin) values (tst.g(), 30, 'conversation', 'Drive talk', 'assistant');
insert into study_notes (group_id, session_id, body, origin) values (tst.g(), tst.s('Drive talk'), 'Q-Links map to pads', 'assistant');
insert into study_notes (group_id, session_id, body) values (tst.g(), tst.s('Drive talk'), 'Added by hand to the draft');
select tst.expect((select not published from study_sessions where id = tst.s('Drive talk')), 'Claude''s session arrives as a draft');
select tst.expect((select bool_and(not published) from study_notes where session_id = tst.s('Drive talk')),
  'every note in a draft session is a draft, whoever added it');
select tst.refused($$update study_sessions set published = true where id = tst.s('Drive talk')$$, 'publishing by a direct update');

select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 1 from study_sessions where group_id = tst.g()), 'a partner sees published sessions, not drafts');
select tst.expect((select count(*) = 1 from study_notes where group_id = tst.g()), 'a partner sees published notes, not draft ones');
select tst.refused($$select study_session_publish(tst.s('Drive talk'))$$, 'someone else publishing a draft');
select tst.affects($$update study_sessions set summary = 'x'$$, 0, 'a partner changing someone''s session');
select tst.affects($$update study_notes set body = 'x'$$, 0, 'a partner changing someone''s note');
select tst.refused($$insert into study_notes (group_id, session_id, body) values (tst.g(), tst.s('Chopped a break'), 'mine')$$,
  'a note in someone else''s session');

select set_config('app.user_id', 'J', false);
select tst.expect(study_session_publish(tst.s('Drive talk')) = 2, 'publishing a session publishes its notes');
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 2 from study_sessions where group_id = tst.g()), 'a published draft is seen by partners');
select tst.expect((select origin = 'assistant' from study_sessions where id = tst.s('Drive talk')), 'it stays marked as Claude''s');

-- Private.
select set_config('app.user_id', 'J', false);
update study_sessions set private = true where id = tst.s('Chopped a break');
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 0 from study_notes where body = 'Pad 9 clicks'), 'a private session hides its notes');
select set_config('app.user_id', 'J', false);
select tst.expect((select count(*) = 1 from study_notes where body = 'Pad 9 clicks'), 'its author still sees them');
insert into study_notes (group_id, body, private) values (tst.g(), 'Just for me', true);
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 0 from study_notes where body = 'Just for me'), 'a private note is hidden from partners');
select set_config('app.user_id', 'O', false);
select tst.expect((select count(*) = 0 from study_sessions) and (select count(*) = 0 from study_notes),
  'someone outside the group sees nothing');

-- Deleting.
select set_config('app.user_id', 'J', false);
select tst.refused($$update study_sessions set published = false where id = tst.s('Drive talk')$$, 'unpublishing');
select tst.affects($$delete from study_sessions where id = tst.s('Drive talk')$$, 0, 'deleting a published session');
insert into study_sessions (group_id, summary, origin) values (tst.g(), 'Misheard', 'assistant');
insert into study_notes (group_id, session_id, body, origin) values (tst.g(), tst.s('Misheard'), 'garbled', 'assistant');
select tst.affects($$delete from study_sessions where id = tst.s('Misheard')$$, 1, 'discarding one''s own draft');
select tst.expect((select count(*) = 0 from study_notes where body = 'garbled'), 'its notes go with it');
select tst.refused($$update study_notes set group_id = group_id + 1 where body = 'Just for me'$$, 'moving a note to another group');

-- A closed group.
select study_group_set_status(tst.g(), 'closed');
select tst.refused($$insert into study_notes (group_id, body) values (tst.g(), 'late')$$, 'writing in a closed group');
select study_group_set_status(tst.g(), 'open');

reset role;
select 'all 017 tests passed' as result;

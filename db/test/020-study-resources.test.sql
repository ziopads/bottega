-- Tests for db/020-study-resources.sql: videos and links in a group, Claude's
-- drafts, removal, and notes at a moment in a video.
--
-- Run once against a fresh scratch database with 001–020 applied, never Neon.
--
--   psql -d bottega_test -f db/test/020-study-resources.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'Person A', 'active', true), ('C', 'c@x', 'Person B', 'active', false), ('O', 'o@x', 'Outsider', 'active', false)
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
create or replace function tst.r(t text) returns bigint language sql security definer as $$ select id from study_resources where title = t $$;
create or replace function tst.note(b text) returns study_notes language sql security definer as $$ select * from study_notes where body = b $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

select set_config('app.user_id', 'J', false);
insert into study_groups (name) values ('MPC study');
insert into study_topics (group_id, title) values (tst.g(), 'Sampling');
select study_group_invite(tst.g(), 'c@x');
select set_config('app.user_id', 'C', false);
select study_invitation_answer((select id from study_group_invitations where account_id = 'C'), true);

-- A member adds a video, filed under a topic.
insert into study_resources (group_id, kind, url, youtube_id, title, channel)
  values (tst.g(), 'video', 'https://www.youtube.com/watch?v=abcdefghijk', 'abcdefghijk', 'Chopping breaks', 'MPC Tutor');
insert into study_resource_topics values (tst.r('Chopping breaks'), (select id from study_topics where title = 'Sampling'));
select tst.expect((select published and added_by = 'C' from study_resources where id = tst.r('Chopping breaks')),
  'a member''s video is published, in their name');
select tst.refused($$insert into study_resources (group_id, kind, url, youtube_id, title)
  values (tst.g(), 'video', 'https://youtu.be/abcdefghijk', 'abcdefghijk', 'Again')$$, 'the same video twice in a group');
select tst.refused($$insert into study_resources (group_id, kind, url, title) values (tst.g(), 'video', 'https://example.com/x', 'No id')$$,
  'a video without its YouTube id');
select tst.refused($$insert into study_resources (group_id, kind, url, title) values (tst.g(), 'link', 'http://example.com/x', 'Plain http')$$,
  'a link that is not https');

-- Notes at a moment.
insert into study_notes (group_id, resource_id, position_s, body) values (tst.g(), tst.r('Chopping breaks'), 272, 'the chop trick');
select tst.expect((tst.note('the chop trick')).position_s = 272, 'a note keeps its moment in the video');
insert into study_notes (group_id, position_s, body) values (tst.g(), 30, 'a moment without a video');
select tst.expect((tst.note('a moment without a video')).position_s is null, 'a moment without a video is cleared');

-- Claude's draft.
select set_config('app.user_id', 'J', false);
insert into study_resources (group_id, kind, url, title, origin) values (tst.g(), 'link', 'https://example.com/guide', 'A guide', 'assistant');
select tst.expect((select not published from study_resources where id = tst.r('A guide')), 'Claude''s resource arrives as a draft');
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 1 from study_resources), 'a partner does not see the draft');
select tst.refused($$select study_resource_publish(tst.r('A guide'))$$, 'someone else publishing the draft');
select set_config('app.user_id', 'J', false);
select study_resource_publish(tst.r('A guide'));
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 2 from study_resources), 'published, every member sees it');

-- Who changes and removes.
select tst.affects($$update study_resources set title = 'x' where id = tst.r('A guide')$$, 0, 'a member editing someone else''s resource');
select tst.affects($$delete from study_resources where id = tst.r('A guide')$$, 0, 'a member removing someone else''s resource');
select tst.refused($$update study_resources set url = 'https://example.com/y' where id = tst.r('Chopping breaks')$$, 'changing a resource''s address');
select set_config('app.user_id', 'O', false);
select tst.expect((select count(*) = 0 from study_resources), 'someone outside the group sees nothing');
select set_config('app.user_id', 'J', false);
select tst.affects($$delete from study_resources where id = tst.r('Chopping breaks')$$, 1, 'the custodian removes a member''s video');
select tst.expect((tst.note('the chop trick')).resource_id is null and (tst.note('the chop trick')).position_s is null,
  'its notes stay, without the video and moment');

reset role;
select 'all 020 tests passed' as result;

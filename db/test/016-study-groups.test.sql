-- Tests for db/016-study-groups.sql: groups, invitations and membership, the
-- syllabus and Claude's proposals, progress, documents shared with a group,
-- and the access log.
--
-- Run once against a fresh scratch database with 001–016 applied, never Neon.
--
--   psql -d bottega_test -f db/test/016-study-groups.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('C', 'c@x', 'Chris', 'active', false), ('G', 'g@x', 'Gordon', 'active', false),
  ('P', 'p@x', 'Pending', 'pending', false), ('O', 'o@x', 'Outsider', 'active', false)
on conflict (user_id) do nothing;
insert into gear_models (kind, category, manufacturer, model, status) values ('hardware', 'sampler', 'Akai', 'MPC One', 'approved')
on conflict do nothing;
insert into documents (library, review_status, owner_id, contributed_by, kind, title, r2_key, filename, bytes, sha256)
  values (false, 'approved', 'J', 'J', 'book', 'MPC Bible', 'private/J/bible.pdf', 'bible.pdf', 1000, repeat('b', 64));
insert into pages (document_id, page_number, text)
  select id, 42, 'Chop the sample into sixteen slices.' from documents where title = 'MPC Bible';
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
-- Rows changed by a statement as the current role (0 when policies hide them).
create or replace function tst.affects(stmt text, n int, what text) returns void language plpgsql as $$
declare got int;
begin
  execute stmt; get diagnostics got = row_count;
  if got <> n then raise exception 'FAILED: % (changed %, expected %)', what, got, n; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.g() returns bigint language sql security definer as $$ select id from study_groups where name = 'MPC study' $$;
create or replace function tst.topic(t text) returns bigint language sql security definer as $$ select id from study_topics where title = t $$;
create or replace function tst.lesson(t text) returns bigint language sql security definer as $$ select id from study_lessons where title = t $$;
create or replace function tst.ex(t text) returns bigint language sql security definer as $$ select id from study_exercises where task = t $$;
create or replace function tst.doc() returns bigint language sql security definer as $$ select id from documents where title = 'MPC Bible' $$;
create or replace function tst.inv(a text) returns bigint language sql security definer as $$
  select id from study_group_invitations where account_id = a and status = 'pending' $$;
create or replace function tst.logged(a text, subj text) returns boolean language sql security definer as $$
  select exists (select 1 from access_log where action = a and item_kind = 'study_group' and item_id = tst.g()
                 and subject_id is not distinct from subj) $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

-- Creating a group --------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
insert into study_groups (name, description, custodian_id) values ('MPC study', 'Learning the MPC together', 'C');
select tst.expect((select custodian_id = 'J' and status = 'open' from study_groups where id = tst.g()),
  'the creator is the custodian, whatever the request says');
select tst.expect(study_member(tst.g()), 'the custodian is the first member');
select tst.expect(tst.logged('study_group_created', 'J'), 'creating a group is logged');
select tst.refused($$insert into study_groups (name) values ('mpc STUDY')$$, 'a second group with the same name');

select set_config('app.user_id', 'P', false);
select tst.refused($$insert into study_groups (name) values ('Pending group')$$, 'a pending account creating a group');

-- Invitations ---------------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
select study_group_invite(tst.g(), 'C@x ');
select tst.expect(tst.logged('study_group_invited', 'C'), 'an invitation is logged');
select tst.refused($$select study_group_invite(tst.g(), 'c@x')$$, 'inviting someone twice');
select tst.refused($$select study_group_invite(tst.g(), 'p@x')$$, 'inviting a pending account');
select tst.refused($$select study_group_invite(tst.g(), 'j@x')$$, 'inviting a member');
select study_group_invite(tst.g(), 'g@x');

select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 1 from study_group_invitations), 'the invitee sees their own invitation only');
select tst.expect((select name = 'MPC study' from study_groups where id = tst.g()), 'the invitee reads the group''s name');
select tst.expect((select count(*) = 0 from study_topics), 'a non-member reads no topics');
select tst.refused($$select study_group_invite(tst.g(), 'o@x')$$, 'a non-custodian inviting');
select tst.refused($$select study_invitation_answer(tst.inv('G'), true)$$, 'answering someone else''s invitation');
select study_invitation_answer(tst.inv('C'), true);
select tst.expect(study_member(tst.g()), 'accepting makes a member');
select tst.expect(tst.logged('study_group_joined', 'C'), 'joining is logged');
select tst.refused($$insert into study_group_members (group_id, account_id, how) values (tst.g(), 'O', 'invited')$$,
  'adding a member directly');

select set_config('app.user_id', 'G', false);
select study_invitation_answer(tst.inv('G'), false);
select tst.expect(not study_member(tst.g()), 'declining makes no member');
select tst.expect(tst.logged('study_group_invitation_declined', 'G'), 'declining is logged');

select set_config('app.user_id', 'J', false);
select study_group_invite(tst.g(), 'g@x');
select study_invitation_withdraw(tst.inv('G'));
select tst.expect(tst.logged('study_group_invitation_withdrawn', 'G'), 'withdrawing is logged');
select set_config('app.user_id', 'G', false);
select tst.refused($$select study_invitation_answer((select max(id) from study_group_invitations where account_id = 'G'), true)$$,
  'accepting a withdrawn invitation');

-- The syllabus ----------------------------------------------------------------------------------
select set_config('app.user_id', 'J', false);
insert into study_topics (group_id, title, model_id)
  values (tst.g(), 'Sampling and chopping', (select id from gear_models where model = 'MPC One'));
insert into study_topics (group_id, title) values (tst.g(), 'Programs');
select tst.expect((select array_agg(position order by id) = '{1,2}' from study_topics), 'new topics go to the end of the list');
insert into study_lessons (topic_id, title, body) values (tst.topic('Sampling and chopping'), 'Slicing a break', 'Chop it [15:p42].');
insert into study_exercises (topic_id, lesson_id, task, done_when)
  values (tst.topic('Sampling and chopping'), tst.lesson('Slicing a break'), 'Chop a break into 16 pads', 'All 16 pads play in order');
select tst.refused($$insert into study_exercises (topic_id, lesson_id, task, done_when)
  values (tst.topic('Programs'), tst.lesson('Slicing a break'), 'x', 'y')$$, 'an exercise whose lesson is in another topic');

-- A member writes only proposals.
select set_config('app.user_id', 'C', false);
select tst.refused($$insert into study_topics (group_id, title) values (tst.g(), 'Mixer')$$, 'a member writing a topic directly');
select tst.refused($$insert into study_topics (group_id, title, origin, reviewed) values (tst.g(), 'Mixer', 'assistant', true)$$,
  'a proposal arriving accepted');
insert into study_topics (group_id, title, origin, reviewed) values (tst.g(), 'Effects and the mixer', 'assistant', false);
insert into study_lessons (topic_id, title, body, origin, reviewed)
  values (tst.topic('Effects and the mixer'), 'Send effects', 'Use a send.', 'assistant', false);
insert into study_exercises (topic_id, task, done_when, origin, reviewed)
  values (tst.topic('Effects and the mixer'), 'Put a reverb on a send', 'Two pads share it', 'assistant', false);
insert into study_lessons (topic_id, title, body, origin, reviewed)
  values (tst.topic('Programs'), 'Program types', 'Drum and keygroup.', 'assistant', false);
select tst.expect((select created_by = 'C' from study_topics where title = 'Effects and the mixer'), 'a proposal names who asked Claude');
select tst.affects($$update study_lessons set reviewed = true where title = 'Program types'$$, 0, 'a member accepting a proposal');
select tst.affects($$update study_topics set title = 'Sampling' where title = 'Sampling and chopping'$$, 0, 'a member editing a topic');

select set_config('app.user_id', 'J', false);
select tst.refused($$update study_lessons set reviewed = true where title = 'Send effects'$$, 'accepting a lesson under a pending topic');
update study_lessons set reviewed = true where title = 'Program types';
select tst.expect((select reviewed from study_lessons where title = 'Program types'), 'the custodian accepts a lesson');
select tst.refused($$update study_lessons set reviewed = false where title = 'Program types'$$, 'un-accepting a lesson');
select tst.refused($$update study_lessons set rejected_at = now() where title = 'Program types'$$, 'rejecting an accepted lesson');
update study_topics set rejected_at = now() where title = 'Effects and the mixer';
select tst.expect((select rejected_at is not null from study_lessons where title = 'Send effects')
                  and (select rejected_at is not null from study_exercises where task = 'Put a reverb on a send'),
  'rejecting a topic rejects what waits under it');
select tst.refused($$update study_topics set rejected_at = null where title = 'Effects and the mixer'$$, 'un-rejecting a topic');
select tst.refused($$update study_topics set group_id = group_id + 1 where title = 'Programs'$$, 'moving a topic to another group');
select tst.refused($$delete from study_topics where title = 'Programs'$$, 'deleting a topic');

-- Progress ---------------------------------------------------------------------------------------
select set_config('app.user_id', 'C', false);
insert into study_progress (exercise_id, status, note) values (tst.ex('Chop a break into 16 pads'), 'practising', 'Pad 9 clicks');
select tst.refused($$insert into study_progress (exercise_id, account_id, status) values (tst.ex('Chop a break into 16 pads'), 'J', 'done')$$,
  'writing someone else''s progress');
select tst.refused($$insert into study_progress (exercise_id, status) values (tst.ex('Put a reverb on a send'), 'done')$$,
  'progress on a rejected proposal');
select set_config('app.user_id', 'J', false);
select tst.affects($$update study_progress set status = 'done'$$, 0, 'the custodian changing a member''s progress');
select tst.expect((select count(*) = 1 from study_progress), 'members read each other''s progress');

-- Documents shared with the group -------------------------------------------------------------------
select set_config('app.user_id', 'C', false);
select tst.expect(document_rank(tst.doc()) = 0, 'a member cannot read the owner''s book before it is shared');
select set_config('app.user_id', 'J', false);
insert into study_group_documents (group_id, document_id) values (tst.g(), tst.doc());
select set_config('app.user_id', 'C', false);
select tst.expect(document_level(tst.doc()) = 'view', 'a member reads a document shared with the group');
select tst.expect((select count(*) = 1 from pages where document_id = tst.doc()), 'a member reads its pages');
select tst.refused($$insert into study_group_documents (group_id, document_id) values (tst.g(), tst.doc())$$,
  'a member sharing a document that is not theirs');
select tst.affects($$delete from study_group_documents$$, 0, 'a member unsharing the owner''s document');
select set_config('app.user_id', 'O', false);
select tst.expect(document_rank(tst.doc()) = 0, 'someone outside the group cannot read it');

-- Leaving and removal --------------------------------------------------------------------------------
select set_config('app.user_id', 'C', false);
select study_group_leave(tst.g());
select tst.expect(not study_member(tst.g()) and document_rank(tst.doc()) = 0, 'leaving ends reading the group''s documents');
select tst.expect(tst.logged('study_group_left', 'C'), 'leaving is logged');
select set_config('app.user_id', 'J', false);
select tst.refused($$select study_group_leave(tst.g())$$, 'the custodian leaving');
select study_group_invite(tst.g(), 'c@x');
select set_config('app.user_id', 'C', false);
select study_invitation_answer(tst.inv('C'), true);
select set_config('app.user_id', 'J', false);
select study_group_remove(tst.g(), 'C');
select tst.expect(tst.logged('study_group_member_removed', 'C'), 'removal is logged');
select tst.refused($$select study_group_remove(tst.g(), 'J')$$, 'the custodian removing themselves');
select tst.expect((select count(*) = 1 from study_progress), 'a removed member''s progress is kept');

-- Closing ----------------------------------------------------------------------------------------------
select tst.refused($$update study_groups set status = 'closed'$$, 'closing by a direct update');
select study_group_set_status(tst.g(), 'closed');
select tst.expect(tst.logged('study_group_closed', null), 'closing is logged');
select tst.refused($$insert into study_topics (group_id, title) values (tst.g(), 'Song mode')$$, 'writing in a closed group');
select tst.affects($$update study_topics set title = 'Programs and keygroups' where title = 'Programs'$$, 0,
  'changing the syllabus of a closed group');
select tst.refused($$select study_group_invite(tst.g(), 'g@x')$$, 'inviting to a closed group');
select tst.expect((select count(*) = 3 from study_topics), 'a closed group stays readable');
select study_group_set_status(tst.g(), 'open');
select tst.expect(tst.logged('study_group_reopened', null), 'reopening is logged');

-- The access log -----------------------------------------------------------------------------------------
select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) > 0 from access_log where item_kind = 'study_group' and subject_id = 'C'),
  'a member reads the entries about themselves');
select tst.expect((select count(*) = 0 from access_log where action = 'study_group_closed'),
  'a member does not read the custodian''s entries');
select set_config('app.user_id', 'J', false);
select tst.expect((select count(*) > 0 from access_log where action = 'study_group_joined'),
  'the custodian reads the entries about their group');

reset role;
select 'all 016 tests passed' as result;

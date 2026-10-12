-- 016 — Learning: study groups, their syllabus and each member's progress
-- (REQUIREMENTS L-2, L-5, L-7 to L-11; ARCHITECTURE §4 Study, §11 Study
-- groups). The first slice, decided 12 October 2026.
--
--   - study_groups: a space belonging to no one account (L-7). Any active
--     account creates one and becomes its custodian, and its first member.
--     A custodian can close the group, which keeps it readable to its members
--     and stops new writing (L-10), and reopen it.
--   - study_group_members: who belongs. People join by invitation only in
--     this slice (asking to join comes later): the custodian invites an
--     active account, the invitee accepts or declines, the custodian can
--     withdraw an invitation and remove a member, and a member can leave.
--     Every one of these is written to the access log (L-11).
--   - study_group_invitations: one row per invitation, kept after it is
--     answered.
--   - study_topics, study_lessons, study_exercises: the syllabus. Topics are
--     ordered within the group and may name a catalogue model; lessons and
--     exercises are ordered within a topic, and an exercise may belong to one
--     of its topic's lessons. The custodian writes the syllabus. Claude, acting
--     for any member through the connector, proposes topics, lessons and
--     exercises (origin 'assistant', reviewed false), and the custodian accepts
--     or rejects them. A lesson's body cites the corpus with markers such as
--     [15:p42], checked by the app when it is saved.
--   - study_progress: one row per member and exercise, written by that member
--     only (L-5): not started, practising or done, with a short note.
--   - study_group_documents: a private document shared with a group. Its
--     current members may read it (view), and lose that when they leave.
--     REQUIREMENTS §15 decision 10: books are shared with named people or with
--     a study group's members.
--
-- Nothing in a group is deleted through the app (L-9, L-10): no delete is
-- granted on any study table except study_group_documents, where unsharing
-- is a change of access made by the document's owner.
--
-- Requires 002, 003, 004. Safe to run twice.

begin;

-- Groups and membership ----------------------------------------------------------------

create table if not exists study_groups (
  id            bigint generated always as identity primary key,
  name          text not null check (name = btrim(name) and name <> '' and char_length(name) <= 80),
  description   text not null default '' check (char_length(description) <= 1000),
  custodian_id  text not null default app_user() references accounts(user_id),
  status        text not null default 'open' check (status in ('open', 'closed')),
  created_by    text not null default app_user() references accounts(user_id),
  created_at    timestamptz not null default now()
);
create unique index if not exists study_groups_name on study_groups (lower(name));

create table if not exists study_group_members (
  group_id    bigint not null references study_groups(id) on delete cascade,
  account_id  text not null references accounts(user_id) on delete cascade,
  how         text not null check (how in ('created', 'invited', 'requested')),
  joined_at   timestamptz not null default now(),
  primary key (group_id, account_id)
);
create index if not exists study_group_members_account_idx on study_group_members (account_id);

create table if not exists study_group_invitations (
  id          bigint generated always as identity primary key,
  group_id    bigint not null references study_groups(id) on delete cascade,
  account_id  text not null references accounts(user_id) on delete cascade,
  invited_by  text not null references accounts(user_id),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create unique index if not exists study_group_invitations_pending
  on study_group_invitations (group_id, account_id) where status = 'pending';
create index if not exists study_group_invitations_account_idx on study_group_invitations (account_id, status);

-- Who the current person is to a group. They read other rows, so they run as
-- the owner; each answers false with no person set.

create or replace function study_member(p_group bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select app_active() and exists (select 1 from study_group_members where group_id = p_group and account_id = app_user())
$body$;

create or replace function study_custodian(p_group bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select app_active() and exists (select 1 from study_groups where id = p_group and custodian_id = app_user())
$body$;

create or replace function study_open(p_group bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select exists (select 1 from study_groups where id = p_group and status = 'open')
$body$;

-- A new group: its creator is its custodian and first member. Name and
-- description change at the custodian's hand (the only columns granted);
-- status only through study_group_set_status(); the custodian does not change
-- in this slice.
create or replace function study_groups_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if tg_op = 'INSERT' then
    if app_user() is not null then
      new.custodian_id := app_user();
      new.created_by := app_user();
      new.status := 'open';
    end if;
    return new;
  end if;
  if new.custodian_id is distinct from old.custodian_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a group''s custodian and creation stay as they are';
  end if;
  return new;
end;
$body$;
drop trigger if exists study_groups_guard on study_groups;
create trigger study_groups_guard before insert or update on study_groups
  for each row execute function study_groups_guard();

create or replace function study_groups_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  insert into study_group_members (group_id, account_id, how) values (new.id, new.custodian_id, 'created');
  perform log_access('study_group_created', new.custodian_id, 'study_group', new.id, null,
    jsonb_build_object('name', new.name), null);
  return new;
end;
$body$;
drop trigger if exists study_groups_created on study_groups;
create trigger study_groups_created after insert on study_groups
  for each row execute function study_groups_created();

-- Membership changes log themselves (L-11), whichever function makes them.
create or replace function study_group_members_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if tg_op = 'INSERT' then
    if new.how <> 'created' then
      perform log_access('study_group_joined', new.account_id, 'study_group', new.group_id, null,
        jsonb_build_object('how', new.how), null);
    end if;
    return new;
  end if;
  if old.account_id = app_user() then
    perform log_access('study_group_left', old.account_id, 'study_group', old.group_id, null, null, null);
  else
    perform log_access('study_group_member_removed', old.account_id, 'study_group', old.group_id, null, null, null);
  end if;
  return old;
end;
$body$;
drop trigger if exists study_group_members_log on study_group_members;
create trigger study_group_members_log after insert or delete on study_group_members
  for each row execute function study_group_members_log();

-- Inviting, answering, withdrawing, leaving, removing, closing ---------------------------

-- The custodian invites an active account by its email. Returns the invitation.
create or replace function study_group_invite(p_group bigint, p_email text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  invitee text;
  new_id bigint;
begin
  if not study_custodian(p_group) or app_admin_viewing() then
    raise exception 'only the group''s custodian invites people';
  end if;
  if not study_open(p_group) then
    raise exception 'the group is closed';
  end if;
  select user_id into invitee from accounts where email = lower(btrim(coalesce(p_email, ''))) and status = 'active';
  if invitee is null then
    raise exception 'no approved account has that email';
  end if;
  if exists (select 1 from study_group_members where group_id = p_group and account_id = invitee) then
    raise exception 'that person is already a member';
  end if;
  if exists (select 1 from study_group_invitations where group_id = p_group and account_id = invitee and status = 'pending') then
    raise exception 'that person already has an invitation waiting';
  end if;
  insert into study_group_invitations (group_id, account_id, invited_by) values (p_group, invitee, app_user())
  returning id into new_id;
  perform log_access('study_group_invited', invitee, 'study_group', p_group, null, null, null);
  return new_id;
end;
$body$;

-- The invitee accepts or declines.
create or replace function study_invitation_answer(p_invitation bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  inv study_group_invitations;
begin
  select * into inv from study_group_invitations where id = p_invitation for update;
  if not found or inv.account_id is distinct from app_user() or not app_active() or app_admin_viewing() then
    raise exception 'no invitation of yours with that id';
  end if;
  if inv.status <> 'pending' then
    raise exception 'that invitation has already been answered';
  end if;
  if p_accept and not study_open(inv.group_id) then
    raise exception 'the group is closed';
  end if;
  update study_group_invitations set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now()
   where id = p_invitation;
  if p_accept then
    insert into study_group_members (group_id, account_id, how) values (inv.group_id, inv.account_id, 'invited')
    on conflict do nothing;
  else
    perform log_access('study_group_invitation_declined', inv.account_id, 'study_group', inv.group_id, null, null, null);
  end if;
end;
$body$;

create or replace function study_invitation_withdraw(p_invitation bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  inv study_group_invitations;
begin
  select * into inv from study_group_invitations where id = p_invitation for update;
  if not found or not study_custodian(inv.group_id) or app_admin_viewing() then
    raise exception 'only the group''s custodian withdraws an invitation';
  end if;
  if inv.status <> 'pending' then
    raise exception 'that invitation has already been answered';
  end if;
  update study_group_invitations set status = 'withdrawn', decided_at = now() where id = p_invitation;
  perform log_access('study_group_invitation_withdrawn', inv.account_id, 'study_group', inv.group_id, null, null, null);
end;
$body$;

-- A member leaves. The custodian cannot: the group would have none (handing
-- custodianship over comes later).
create or replace function study_group_leave(p_group bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if not study_member(p_group) or app_admin_viewing() then
    raise exception 'you are not a member of that group';
  end if;
  if study_custodian(p_group) then
    raise exception 'the custodian cannot leave the group';
  end if;
  delete from study_group_members where group_id = p_group and account_id = app_user();
end;
$body$;

create or replace function study_group_remove(p_group bigint, p_account text) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if not study_custodian(p_group) or app_admin_viewing() then
    raise exception 'only the group''s custodian removes members';
  end if;
  if p_account = app_user() then
    raise exception 'the custodian cannot leave the group';
  end if;
  delete from study_group_members where group_id = p_group and account_id = p_account;
  if not found then
    raise exception 'that person is not a member';
  end if;
end;
$body$;

create or replace function study_group_set_status(p_group bigint, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  cur text;
begin
  if not study_custodian(p_group) or app_admin_viewing() then
    raise exception 'only the group''s custodian closes or reopens it';
  end if;
  if p_status not in ('open', 'closed') then
    raise exception 'a group is open or closed';
  end if;
  select status into cur from study_groups where id = p_group for update;
  if cur = p_status then
    return;
  end if;
  update study_groups set status = p_status where id = p_group;
  perform log_access(case when p_status = 'closed' then 'study_group_closed' else 'study_group_reopened' end,
    null, 'study_group', p_group, null, null, null);
end;
$body$;

-- The syllabus -------------------------------------------------------------------------

create table if not exists study_topics (
  id           bigint generated always as identity primary key,
  group_id     bigint not null references study_groups(id) on delete cascade,
  title        text not null check (title = btrim(title) and title <> '' and char_length(title) <= 120),
  summary      text not null default '' check (char_length(summary) <= 1000),
  model_id     bigint references gear_models(id) on delete set null,
  position     int not null default 0,
  origin       text not null default 'human' check (origin in ('human', 'assistant')),
  reviewed     boolean not null default true,
  rejected_at  timestamptz,
  created_by   text not null default app_user() references accounts(user_id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (origin = 'assistant' or reviewed)
);
create index if not exists study_topics_group_idx on study_topics (group_id, position);

create table if not exists study_lessons (
  id           bigint generated always as identity primary key,
  topic_id     bigint not null references study_topics(id) on delete cascade,
  title        text not null check (title = btrim(title) and title <> '' and char_length(title) <= 160),
  body         text not null check (btrim(body) <> '' and char_length(body) <= 20000),
  position     int not null default 0,
  origin       text not null default 'human' check (origin in ('human', 'assistant')),
  reviewed     boolean not null default true,
  rejected_at  timestamptz,
  created_by   text not null default app_user() references accounts(user_id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (origin = 'assistant' or reviewed)
);
create index if not exists study_lessons_topic_idx on study_lessons (topic_id, position);

create table if not exists study_exercises (
  id           bigint generated always as identity primary key,
  topic_id     bigint not null references study_topics(id) on delete cascade,
  lesson_id    bigint references study_lessons(id) on delete set null,
  task         text not null check (btrim(task) <> '' and char_length(task) <= 2000),
  done_when    text not null check (btrim(done_when) <> '' and char_length(done_when) <= 1000),
  position     int not null default 0,
  origin       text not null default 'human' check (origin in ('human', 'assistant')),
  reviewed     boolean not null default true,
  rejected_at  timestamptz,
  created_by   text not null default app_user() references accounts(user_id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (origin = 'assistant' or reviewed)
);
create index if not exists study_exercises_topic_idx on study_exercises (topic_id, position);

create table if not exists study_progress (
  exercise_id  bigint not null references study_exercises(id) on delete cascade,
  account_id   text not null default app_user() references accounts(user_id) on delete cascade,
  status       text not null check (status in ('not started', 'practising', 'done')),
  note         text not null default '' check (char_length(note) <= 500),
  updated_at   timestamptz not null default now(),
  primary key (exercise_id, account_id)
);

-- The group a syllabus row belongs to.
create or replace function study_topic_group(p_topic bigint) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select group_id from study_topics where id = p_topic
$body$;

create or replace function study_exercise_group(p_exercise bigint) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select t.group_id from study_exercises e join study_topics t on t.id = e.topic_id where e.id = p_exercise
$body$;

-- Who may write a syllabus row. The custodian writes their own (origin
-- 'human', reviewed); any member proposes through Claude (origin
-- 'assistant', unreviewed). Only while the group is open.
create or replace function study_may_write(p_group bigint, p_origin text, p_reviewed boolean) returns boolean
language sql stable as $body$
  select study_member(p_group) and study_open(p_group) and not app_admin_viewing()
     and ((p_origin = 'human' and p_reviewed and study_custodian(p_group))
          or (p_origin = 'assistant' and not p_reviewed))
$body$;

-- Rules the policies cannot hold on their own: rows stay where they were
-- put; a new row goes to the end of its list; who wrote it is the person;
-- a lesson is accepted only once its topic is; an exercise's lesson is one
-- of its topic's; rejecting a topic rejects what waits under it.
create or replace function study_syllabus_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  parent_ok boolean;
begin
  if tg_op = 'INSERT' then
    if app_user() is not null then
      new.created_by := app_user();
    end if;
    new.rejected_at := null;
  else
    if new.created_by is distinct from old.created_by or new.origin is distinct from old.origin
       or new.created_at is distinct from old.created_at then
      raise exception 'who wrote a syllabus entry, and how, stays as it is';
    end if;
    if old.reviewed and not new.reviewed then
      raise exception 'an accepted entry stays accepted';
    end if;
    if old.rejected_at is not null and new.rejected_at is distinct from old.rejected_at then
      raise exception 'a rejected proposal stays rejected';
    end if;
    if new.rejected_at is not null and old.rejected_at is null and old.reviewed then
      raise exception 'only a proposal can be rejected';
    end if;
    new.updated_at := now();
  end if;

  if tg_table_name = 'study_topics' then
    if tg_op = 'UPDATE' and new.group_id <> old.group_id then
      raise exception 'a topic stays in its group';
    end if;
    if tg_op = 'INSERT' and new.position <= 0 then
      select coalesce(max(position), 0) + 1 into new.position from study_topics where group_id = new.group_id;
    end if;
  elsif tg_table_name = 'study_lessons' then
    if tg_op = 'UPDATE' and new.topic_id <> old.topic_id then
      raise exception 'a lesson stays in its topic';
    end if;
    if tg_op = 'INSERT' and new.position <= 0 then
      select coalesce(max(position), 0) + 1 into new.position from study_lessons where topic_id = new.topic_id;
    end if;
    select reviewed and rejected_at is null into parent_ok from study_topics where id = new.topic_id;
    if new.reviewed and not coalesce(parent_ok, false) and (tg_op = 'INSERT' or not old.reviewed) then
      raise exception 'accept its topic first';
    end if;
  else
    if tg_op = 'UPDATE' and new.topic_id <> old.topic_id then
      raise exception 'an exercise stays in its topic';
    end if;
    if new.lesson_id is not null
       and not exists (select 1 from study_lessons where id = new.lesson_id and topic_id = new.topic_id) then
      raise exception 'an exercise''s lesson belongs to the same topic';
    end if;
    if tg_op = 'INSERT' and new.position <= 0 then
      select coalesce(max(position), 0) + 1 into new.position from study_exercises where topic_id = new.topic_id;
    end if;
    select reviewed and rejected_at is null into parent_ok from study_topics where id = new.topic_id;
    if new.reviewed and not coalesce(parent_ok, false) and (tg_op = 'INSERT' or not old.reviewed) then
      raise exception 'accept its topic first';
    end if;
  end if;
  return new;
end;
$body$;
drop trigger if exists study_topics_guard on study_topics;
create trigger study_topics_guard before insert or update on study_topics
  for each row execute function study_syllabus_guard();
drop trigger if exists study_lessons_guard on study_lessons;
create trigger study_lessons_guard before insert or update on study_lessons
  for each row execute function study_syllabus_guard();
drop trigger if exists study_exercises_guard on study_exercises;
create trigger study_exercises_guard before insert or update on study_exercises
  for each row execute function study_syllabus_guard();

create or replace function study_topic_rejected() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if new.rejected_at is not null and old.rejected_at is null then
    update study_lessons set rejected_at = new.rejected_at where topic_id = new.id and not reviewed and rejected_at is null;
    update study_exercises set rejected_at = new.rejected_at where topic_id = new.id and not reviewed and rejected_at is null;
  end if;
  return new;
end;
$body$;
drop trigger if exists study_topic_rejected on study_topics;
create trigger study_topic_rejected after update on study_topics
  for each row execute function study_topic_rejected();

-- Progress: a member's own, on an accepted exercise, while the group is open.
create or replace function study_progress_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if tg_op = 'UPDATE' and (new.exercise_id <> old.exercise_id or new.account_id <> old.account_id) then
    raise exception 'progress stays with its exercise and member';
  end if;
  if not exists (select 1 from study_exercises where id = new.exercise_id and reviewed and rejected_at is null) then
    raise exception 'progress is kept on accepted exercises only';
  end if;
  new.updated_at := now();
  return new;
end;
$body$;
drop trigger if exists study_progress_guard on study_progress;
create trigger study_progress_guard before insert or update on study_progress
  for each row execute function study_progress_guard();

-- Documents shared with a group --------------------------------------------------------

create table if not exists study_group_documents (
  group_id     bigint not null references study_groups(id) on delete cascade,
  document_id  bigint not null references documents(id) on delete cascade,
  shared_by    text not null default app_user() references accounts(user_id),
  shared_at    timestamptz not null default now(),
  primary key (group_id, document_id)
);
create index if not exists study_group_documents_document_idx on study_group_documents (document_id);

create or replace function study_group_documents_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  g text;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from documents where id = new.document_id and library) then
      raise exception 'library documents are not shared; they are visible to everyone once approved';
    end if;
    select name into g from study_groups where id = new.group_id;
    perform log_access('document_shared_with_group', null, 'document', new.document_id, null,
      jsonb_build_object('group_id', new.group_id, 'group', g, 'level', 'view'), null);
    return new;
  end if;
  select name into g from study_groups where id = old.group_id;
  perform log_access('document_unshared_from_group', null, 'document', old.document_id,
    jsonb_build_object('group_id', old.group_id, 'group', g), null, null);
  return old;
end;
$body$;
drop trigger if exists study_group_documents_log on study_group_documents;
create trigger study_group_documents_log after insert or delete on study_group_documents
  for each row execute function study_group_documents_log();

-- document_rank (004) gains one rule: a private document shared with a group
-- is readable (view) by that group's current members.
create or replace function document_rank(p_document_id bigint) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  d documents;
  best int := 0;
begin
  if me is null or not app_active() then
    return 0;
  end if;
  select * into d from documents where id = p_document_id;
  if not found then
    return 0;
  end if;
  if d.library then
    if app_is_admin() then
      return 4;
    end if;
    if d.review_status = 'approved' then
      return 1;
    end if;
    if d.contributed_by = me and d.review_status = 'submitted' then
      return 3;
    end if;
    if d.contributed_by = me then
      return 1;   -- rejected: still readable by its contributor, nothing more
    end if;
    return 0;
  end if;
  if d.owner_id = me then
    return 4;
  end if;
  select coalesce(max(level_rank(level)), 0) into best from shares where document_id = p_document_id and grantee_id = me;
  if best < 1 and exists (
    select 1 from study_group_documents sgd
      join study_group_members m on m.group_id = sgd.group_id and m.account_id = me
     where sgd.document_id = p_document_id
  ) then
    best := 1;
  end if;
  if best < 1 and app_admin_viewing() then
    best := 1;
  end if;
  return best;
end;
$body$;

-- The access log: a custodian reads the entries about their group.
drop policy if exists access_log_read on access_log;
create policy access_log_read on access_log for select
  using (
    app_is_admin()
    or (app_active() and (
      actor = app_user() or subject_id = app_user()
      or (item_kind = 'project' and project_rank(item_id) = 4)
      or (item_kind = 'gear' and gear_rank(item_id) = 4)
      or (item_kind = 'document' and document_rank(item_id) = 4)
      or (item_kind = 'study_group' and study_custodian(item_id))
    ))
  );

-- Row-level security ----------------------------------------------------------------------

alter table study_groups            enable row level security;
alter table study_group_members     enable row level security;
alter table study_group_invitations enable row level security;
alter table study_topics            enable row level security;
alter table study_lessons           enable row level security;
alter table study_exercises         enable row level security;
alter table study_progress          enable row level security;
alter table study_group_documents   enable row level security;

-- Group names are listed for every active account (L-11); contents for members.
drop policy if exists study_groups_read on study_groups;
create policy study_groups_read on study_groups for select using (app_active());
drop policy if exists study_groups_insert on study_groups;
create policy study_groups_insert on study_groups for insert
  with check (app_active() and custodian_id = app_user() and not app_admin_viewing());
drop policy if exists study_groups_update on study_groups;
create policy study_groups_update on study_groups for update
  using (study_custodian(id) and not app_admin_viewing())
  with check (study_custodian(id));

drop policy if exists study_group_members_read on study_group_members;
create policy study_group_members_read on study_group_members for select
  using (study_member(group_id) or account_id = app_user() or app_is_admin());

drop policy if exists study_group_invitations_read on study_group_invitations;
create policy study_group_invitations_read on study_group_invitations for select
  using ((app_active() and account_id = app_user()) or study_custodian(group_id) or app_is_admin());

drop policy if exists study_topics_read on study_topics;
create policy study_topics_read on study_topics for select using (study_member(group_id) or app_admin_viewing());
drop policy if exists study_topics_insert on study_topics;
create policy study_topics_insert on study_topics for insert
  with check (created_by = app_user() and study_may_write(group_id, origin, reviewed));
drop policy if exists study_topics_update on study_topics;
create policy study_topics_update on study_topics for update
  using (study_custodian(group_id) and study_open(group_id) and not app_admin_viewing())
  with check (study_custodian(group_id));

drop policy if exists study_lessons_read on study_lessons;
create policy study_lessons_read on study_lessons for select
  using (study_member(study_topic_group(topic_id)) or app_admin_viewing());
drop policy if exists study_lessons_insert on study_lessons;
create policy study_lessons_insert on study_lessons for insert
  with check (created_by = app_user() and study_may_write(study_topic_group(topic_id), origin, reviewed));
drop policy if exists study_lessons_update on study_lessons;
create policy study_lessons_update on study_lessons for update
  using (study_custodian(study_topic_group(topic_id)) and study_open(study_topic_group(topic_id)) and not app_admin_viewing())
  with check (study_custodian(study_topic_group(topic_id)));

drop policy if exists study_exercises_read on study_exercises;
create policy study_exercises_read on study_exercises for select
  using (study_member(study_topic_group(topic_id)) or app_admin_viewing());
drop policy if exists study_exercises_insert on study_exercises;
create policy study_exercises_insert on study_exercises for insert
  with check (created_by = app_user() and study_may_write(study_topic_group(topic_id), origin, reviewed));
drop policy if exists study_exercises_update on study_exercises;
create policy study_exercises_update on study_exercises for update
  using (study_custodian(study_topic_group(topic_id)) and study_open(study_topic_group(topic_id)) and not app_admin_viewing())
  with check (study_custodian(study_topic_group(topic_id)));

drop policy if exists study_progress_read on study_progress;
create policy study_progress_read on study_progress for select
  using (study_member(study_exercise_group(exercise_id)) or app_admin_viewing());
drop policy if exists study_progress_insert on study_progress;
create policy study_progress_insert on study_progress for insert
  with check (account_id = app_user() and study_member(study_exercise_group(exercise_id))
              and study_open(study_exercise_group(exercise_id)) and not app_admin_viewing());
drop policy if exists study_progress_update on study_progress;
create policy study_progress_update on study_progress for update
  using (account_id = app_user() and study_member(study_exercise_group(exercise_id))
         and study_open(study_exercise_group(exercise_id)) and not app_admin_viewing())
  with check (account_id = app_user());

-- A document's owner shares it with a group they belong to, and unshares it.
drop policy if exists study_group_documents_read on study_group_documents;
create policy study_group_documents_read on study_group_documents for select
  using (study_member(group_id) or document_rank(document_id) = 4);
drop policy if exists study_group_documents_insert on study_group_documents;
create policy study_group_documents_insert on study_group_documents for insert
  with check (document_rank(document_id) = 4 and study_member(group_id) and shared_by = app_user()
              and not app_admin_viewing());
drop policy if exists study_group_documents_delete on study_group_documents;
create policy study_group_documents_delete on study_group_documents for delete
  using (document_rank(document_id) = 4 and not app_admin_viewing());

-- Grants ------------------------------------------------------------------------------------

grant select on study_groups, study_group_members, study_group_invitations, study_topics, study_lessons,
  study_exercises, study_progress, study_group_documents to bottega_app;
grant insert on study_groups, study_topics, study_lessons, study_exercises, study_progress, study_group_documents
  to bottega_app;
grant update (name, description) on study_groups to bottega_app;
grant update (title, summary, model_id, position, reviewed, rejected_at) on study_topics to bottega_app;
grant update (title, body, position, reviewed, rejected_at) on study_lessons to bottega_app;
grant update (lesson_id, task, done_when, position, reviewed, rejected_at) on study_exercises to bottega_app;
grant update (status, note) on study_progress to bottega_app;
grant delete on study_group_documents to bottega_app;
grant usage on all sequences in schema public to bottega_app;

revoke execute on function study_group_invite(bigint, text) from public;
revoke execute on function study_invitation_answer(bigint, boolean) from public;
revoke execute on function study_invitation_withdraw(bigint) from public;
revoke execute on function study_group_leave(bigint) from public;
revoke execute on function study_group_remove(bigint, text) from public;
revoke execute on function study_group_set_status(bigint, text) from public;
grant execute on function study_group_invite(bigint, text) to bottega_app;
grant execute on function study_invitation_answer(bigint, boolean) to bottega_app;
grant execute on function study_invitation_withdraw(bigint) to bottega_app;
grant execute on function study_group_leave(bigint) to bottega_app;
grant execute on function study_group_remove(bigint, text) to bottega_app;
grant execute on function study_group_set_status(bigint, text) to bottega_app;

commit;

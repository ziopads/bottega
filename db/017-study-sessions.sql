-- 017 — Learning: study sessions and notes (REQUIREMENTS L-3, L-18 to L-22;
-- decided 12 October 2026).
--
--   - study_sessions: one member's sitting in one group: when, how long, what
--     kind (at the instrument, a conversation, reading, a video, other), a
--     summary, and the topics it touched (study_session_topics). Progress
--     counts sessions per topic and splits a session's minutes evenly across
--     its topics.
--   - study_notes: a member's note, with its author and time, standing alone
--     or in one of their sessions, and optionally on a topic, a lesson or an
--     exercise of the same group. A note's body may cite the corpus with the
--     lessons' markers ([15:p42]); the app checks them when it is saved.
--
-- Drafts. What Claude documents through the connector (origin 'assistant')
-- arrives unpublished: only its author sees it, until they publish the
-- session, which publishes its notes with it. What a member writes in the app
-- is published at once. An author may discard their own drafts; nothing
-- published is deleted through the app (L-9).
--
-- Visibility. Sessions and notes are shared with the group by default; the
-- author may mark one private. A note in a private session is private with
-- it. The custodian has no extra rights here: each member's record is their
-- own.
--
-- Requires 016. Safe to run twice.

begin;

create table if not exists study_sessions (
  id           bigint generated always as identity primary key,
  group_id     bigint not null references study_groups(id) on delete cascade,
  author_id    text not null default app_user() references accounts(user_id),
  started_at   timestamptz not null default now(),
  minutes      int check (minutes is null or minutes between 1 and 1440),
  kind         text not null default 'at the instrument'
               check (kind in ('at the instrument', 'conversation', 'reading', 'video', 'other')),
  summary      text not null default '' check (char_length(summary) <= 8000),
  private      boolean not null default false,
  origin       text not null default 'human' check (origin in ('human', 'assistant')),
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists study_sessions_group_idx on study_sessions (group_id, started_at desc);
create index if not exists study_sessions_author_idx on study_sessions (author_id, started_at desc);

create table if not exists study_session_topics (
  session_id  bigint not null references study_sessions(id) on delete cascade,
  topic_id    bigint not null references study_topics(id) on delete cascade,
  primary key (session_id, topic_id)
);
create index if not exists study_session_topics_topic_idx on study_session_topics (topic_id);

create table if not exists study_notes (
  id           bigint generated always as identity primary key,
  group_id     bigint not null references study_groups(id) on delete cascade,
  author_id    text not null default app_user() references accounts(user_id),
  session_id   bigint references study_sessions(id) on delete cascade,
  topic_id     bigint references study_topics(id) on delete set null,
  lesson_id    bigint references study_lessons(id) on delete set null,
  exercise_id  bigint references study_exercises(id) on delete set null,
  body         text not null check (btrim(body) <> '' and char_length(body) <= 10000),
  private      boolean not null default false,
  origin       text not null default 'human' check (origin in ('human', 'assistant')),
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists study_notes_group_idx on study_notes (group_id, created_at desc);
create index if not exists study_notes_session_idx on study_notes (session_id);

-- Who may see a session or note. Its author always; other members once it is
-- published and not private (and, for a note in a session, once the session
-- is too). The platform administrator's read-only view sees what members see.
create or replace function study_session_visible(p_session bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select exists (
    select 1 from study_sessions s
     where s.id = p_session
       and (study_member(s.group_id) or app_admin_viewing())
       and (s.author_id = app_user() or (s.published and not s.private))
  )
$body$;

-- Rules the policies cannot hold on their own.
create or replace function study_sessions_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if tg_op = 'INSERT' then
    if app_user() is not null then
      new.author_id := app_user();
    end if;
    -- Claude's writing arrives as a draft; a member's own is published.
    new.published := new.origin = 'human';
    return new;
  end if;
  if new.group_id <> old.group_id or new.author_id <> old.author_id or new.origin <> old.origin
     or new.created_at <> old.created_at then
    raise exception 'a session stays with its group, author and origin';
  end if;
  if old.published and not new.published then
    raise exception 'a published session stays published; mark it private instead';
  end if;
  new.updated_at := now();
  return new;
end;
$body$;
drop trigger if exists study_sessions_guard on study_sessions;
create trigger study_sessions_guard before insert or update on study_sessions
  for each row execute function study_sessions_guard();

create or replace function study_session_topics_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if not exists (
    select 1 from study_sessions s join study_topics t on t.group_id = s.group_id
     where s.id = new.session_id and t.id = new.topic_id and t.rejected_at is null
  ) then
    raise exception 'a session''s topics belong to its group';
  end if;
  return new;
end;
$body$;
drop trigger if exists study_session_topics_check on study_session_topics;
create trigger study_session_topics_check before insert on study_session_topics
  for each row execute function study_session_topics_check();

create or replace function study_notes_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  s study_sessions;
begin
  if tg_op = 'INSERT' then
    if app_user() is not null then
      new.author_id := app_user();
    end if;
    new.published := new.origin = 'human';
  else
    if new.group_id <> old.group_id or new.author_id <> old.author_id or new.origin <> old.origin
       or new.created_at <> old.created_at then
      raise exception 'a note stays with its group, author and origin';
    end if;
    if old.published and not new.published then
      raise exception 'a published note stays published; mark it private instead';
    end if;
    new.updated_at := now();
  end if;

  if new.session_id is not null and (tg_op = 'INSERT' or new.session_id is distinct from old.session_id) then
    select * into s from study_sessions where id = new.session_id;
    if not found or s.group_id <> new.group_id or s.author_id <> new.author_id then
      raise exception 'a note''s session is one of its author''s sessions in the same group';
    end if;
    -- A note added to a draft session is a draft with it.
    if not s.published then
      new.published := false;
    end if;
  end if;
  if new.topic_id is not null
     and not exists (select 1 from study_topics where id = new.topic_id and group_id = new.group_id) then
    raise exception 'a note''s topic belongs to its group';
  end if;
  if new.lesson_id is not null and not exists (
    select 1 from study_lessons l join study_topics t on t.id = l.topic_id where l.id = new.lesson_id and t.group_id = new.group_id
  ) then
    raise exception 'a note''s lesson belongs to its group';
  end if;
  if new.exercise_id is not null and not exists (
    select 1 from study_exercises e join study_topics t on t.id = e.topic_id where e.id = new.exercise_id and t.group_id = new.group_id
  ) then
    raise exception 'a note''s exercise belongs to its group';
  end if;
  return new;
end;
$body$;
drop trigger if exists study_notes_guard on study_notes;
create trigger study_notes_guard before insert or update on study_notes
  for each row execute function study_notes_guard();

-- Publishing a draft session publishes its notes with it. Returns how many notes.
create or replace function study_session_publish(p_session bigint) returns int
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  s study_sessions;
  n int;
begin
  select * into s from study_sessions where id = p_session for update;
  if not found or s.author_id is distinct from app_user() or not app_active() or app_admin_viewing() then
    raise exception 'only the session''s author publishes it';
  end if;
  if not study_open(s.group_id) then
    raise exception 'the group is closed';
  end if;
  update study_sessions set published = true where id = p_session;
  update study_notes set published = true where session_id = p_session and not published;
  get diagnostics n = row_count;
  return n;
end;
$body$;

-- Row-level security ----------------------------------------------------------------------

alter table study_sessions       enable row level security;
alter table study_session_topics enable row level security;
alter table study_notes          enable row level security;

drop policy if exists study_sessions_read on study_sessions;
create policy study_sessions_read on study_sessions for select
  using ((study_member(group_id) or app_admin_viewing())
         and (author_id = app_user() or (published and not private)));
drop policy if exists study_sessions_insert on study_sessions;
create policy study_sessions_insert on study_sessions for insert
  with check (author_id = app_user() and study_member(group_id) and study_open(group_id) and not app_admin_viewing());
drop policy if exists study_sessions_update on study_sessions;
create policy study_sessions_update on study_sessions for update
  using (author_id = app_user() and study_member(group_id) and study_open(group_id) and not app_admin_viewing())
  with check (author_id = app_user());
-- An author discards their own draft, never a published session.
drop policy if exists study_sessions_delete on study_sessions;
create policy study_sessions_delete on study_sessions for delete
  using (author_id = app_user() and not published and not app_admin_viewing());

drop policy if exists study_session_topics_read on study_session_topics;
create policy study_session_topics_read on study_session_topics for select using (study_session_visible(session_id));
drop policy if exists study_session_topics_insert on study_session_topics;
create policy study_session_topics_insert on study_session_topics for insert
  with check (exists (select 1 from study_sessions s where s.id = session_id and s.author_id = app_user()
                      and study_open(s.group_id) and not app_admin_viewing()));
drop policy if exists study_session_topics_delete on study_session_topics;
create policy study_session_topics_delete on study_session_topics for delete
  using (exists (select 1 from study_sessions s where s.id = session_id and s.author_id = app_user()
                 and study_open(s.group_id) and not app_admin_viewing()));

drop policy if exists study_notes_read on study_notes;
create policy study_notes_read on study_notes for select
  using ((study_member(group_id) or app_admin_viewing())
         and (author_id = app_user()
              or (published and not private and (session_id is null or study_session_visible(session_id)))));
drop policy if exists study_notes_insert on study_notes;
create policy study_notes_insert on study_notes for insert
  with check (author_id = app_user() and study_member(group_id) and study_open(group_id) and not app_admin_viewing());
drop policy if exists study_notes_update on study_notes;
create policy study_notes_update on study_notes for update
  using (author_id = app_user() and study_member(group_id) and study_open(group_id) and not app_admin_viewing())
  with check (author_id = app_user());
drop policy if exists study_notes_delete on study_notes;
create policy study_notes_delete on study_notes for delete
  using (author_id = app_user() and not published and not app_admin_viewing());

grant select, insert, delete on study_sessions, study_session_topics, study_notes to bottega_app;
grant update (started_at, minutes, kind, summary, private) on study_sessions to bottega_app;
grant update (topic_id, lesson_id, exercise_id, body, private) on study_notes to bottega_app;
grant usage on all sequences in schema public to bottega_app;

revoke execute on function study_session_publish(bigint) from public;
grant execute on function study_session_publish(bigint) to bottega_app;

commit;

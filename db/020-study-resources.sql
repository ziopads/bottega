-- 020 — Learning: resources, starting with videos (REQUIREMENTS L-23,
-- decided 12 October 2026).
--
--   - study_resources: a video (YouTube, played in the app) or a link that a
--     member adds to a group, with its title, channel and thumbnail (from
--     YouTube's oEmbed when added), why it is worth the time, and the topics
--     it is filed under (study_resource_topics).
--   - Notes gain a resource and a moment in it (resource_id, position_s):
--     "4:32, the chop trick", which opens the video at 4:32. A moment without
--     a resource is cleared.
--   - Sessions gain the resource they were spent on (resource_id).
--
-- Any member adds a resource while the group is open. Claude adds one through
-- the connector as a draft (origin 'assistant', unpublished) that only the
-- member it acted for sees, until they publish it. The member who added a
-- resource, or the custodian, removes it; its notes stay, without the
-- resource and moment. The member who added it edits its title, why and
-- topics.
--
-- Requires 016, 017. Safe to run twice.

begin;

create table if not exists study_resources (
  id             bigint generated always as identity primary key,
  group_id       bigint not null references study_groups(id) on delete cascade,
  kind           text not null default 'video' check (kind in ('video', 'link')),
  url            text not null check (url ~ '^https://' and char_length(url) <= 2000),
  youtube_id     text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title          text not null check (btrim(title) <> '' and char_length(title) <= 300),
  channel        text not null default '' check (char_length(channel) <= 200),
  thumbnail_url  text not null default '' check (thumbnail_url = '' or (thumbnail_url ~ '^https://' and char_length(thumbnail_url) <= 2000)),
  why            text not null default '' check (char_length(why) <= 1000),
  added_by       text not null default app_user() references accounts(user_id),
  origin         text not null default 'human' check (origin in ('human', 'assistant')),
  published      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (kind <> 'video' or youtube_id is not null)
);
create index if not exists study_resources_group_idx on study_resources (group_id, created_at desc);
create unique index if not exists study_resources_group_video on study_resources (group_id, youtube_id) where youtube_id is not null;

create table if not exists study_resource_topics (
  resource_id  bigint not null references study_resources(id) on delete cascade,
  topic_id     bigint not null references study_topics(id) on delete cascade,
  primary key (resource_id, topic_id)
);
create index if not exists study_resource_topics_topic_idx on study_resource_topics (topic_id);

alter table study_notes add column if not exists resource_id bigint references study_resources(id) on delete set null;
alter table study_notes add column if not exists position_s real check (position_s is null or (position_s >= 0 and position_s < 86400));
create index if not exists study_notes_resource_idx on study_notes (resource_id) where resource_id is not null;

alter table study_sessions add column if not exists resource_id bigint references study_resources(id) on delete set null;

create or replace function study_resource_visible(p_resource bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select exists (
    select 1 from study_resources r
     where r.id = p_resource and (study_member(r.group_id) or app_admin_viewing())
       and (r.published or r.added_by = app_user())
  )
$body$;

create or replace function study_resources_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if tg_op = 'INSERT' then
    if app_user() is not null then
      new.added_by := app_user();
    end if;
    new.published := new.origin = 'human';
    return new;
  end if;
  if new.group_id <> old.group_id or new.added_by <> old.added_by or new.origin <> old.origin
     or new.created_at <> old.created_at or new.kind <> old.kind or new.url <> old.url
     or new.youtube_id is distinct from old.youtube_id then
    raise exception 'a resource keeps its group, address and who added it';
  end if;
  if old.published and not new.published then
    raise exception 'a published resource stays published';
  end if;
  new.updated_at := now();
  return new;
end;
$body$;
drop trigger if exists study_resources_guard on study_resources;
create trigger study_resources_guard before insert or update on study_resources
  for each row execute function study_resources_guard();

create or replace function study_resource_topics_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if not exists (
    select 1 from study_resources r join study_topics t on t.group_id = r.group_id
     where r.id = new.resource_id and t.id = new.topic_id and t.rejected_at is null
  ) then
    raise exception 'a resource''s topics belong to its group';
  end if;
  return new;
end;
$body$;
drop trigger if exists study_resource_topics_check on study_resource_topics;
create trigger study_resource_topics_check before insert on study_resource_topics
  for each row execute function study_resource_topics_check();

-- Sessions: the resource they were spent on, from the same group.
create or replace function study_sessions_resource_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if new.resource_id is not null
     and (tg_op = 'INSERT' or new.resource_id is distinct from old.resource_id)
     and not exists (select 1 from study_resources where id = new.resource_id and group_id = new.group_id) then
    raise exception 'a session''s resource belongs to its group';
  end if;
  return new;
end;
$body$;
drop trigger if exists study_sessions_resource_check on study_sessions;
create trigger study_sessions_resource_check before insert or update on study_sessions
  for each row execute function study_sessions_resource_check();

-- Notes: 017's guard, with the resource and its moment.
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
  if new.resource_id is null then
    new.position_s := null;   -- a moment belongs to a video
  elsif (tg_op = 'INSERT' or new.resource_id is distinct from old.resource_id)
        and not exists (select 1 from study_resources where id = new.resource_id and group_id = new.group_id) then
    raise exception 'a note''s resource belongs to its group';
  end if;
  if new.exercise_id is not null and not exists (
    select 1 from study_exercises e join study_topics t on t.id = e.topic_id where e.id = new.exercise_id and t.group_id = new.group_id
  ) then
    raise exception 'a note''s exercise belongs to its group';
  end if;
  return new;
end;
$body$;

-- Publishing a resource Claude added: the member it acted for.
create or replace function study_resource_publish(p_resource bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  r study_resources;
begin
  select * into r from study_resources where id = p_resource for update;
  if not found or r.added_by is distinct from app_user() or not app_active() or app_admin_viewing() then
    raise exception 'only the member it was added for publishes a resource';
  end if;
  if not study_open(r.group_id) then
    raise exception 'the group is closed';
  end if;
  update study_resources set published = true where id = p_resource;
end;
$body$;

-- Row-level security ----------------------------------------------------------------------

alter table study_resources       enable row level security;
alter table study_resource_topics enable row level security;

drop policy if exists study_resources_read on study_resources;
create policy study_resources_read on study_resources for select
  using ((study_member(group_id) or app_admin_viewing()) and (published or added_by = app_user()));
drop policy if exists study_resources_insert on study_resources;
create policy study_resources_insert on study_resources for insert
  with check (added_by = app_user() and study_member(group_id) and study_open(group_id) and not app_admin_viewing());
drop policy if exists study_resources_update on study_resources;
create policy study_resources_update on study_resources for update
  using (added_by = app_user() and study_member(group_id) and study_open(group_id) and not app_admin_viewing())
  with check (added_by = app_user());
drop policy if exists study_resources_delete on study_resources;
create policy study_resources_delete on study_resources for delete
  using ((added_by = app_user() or study_custodian(group_id)) and study_member(group_id) and not app_admin_viewing());

drop policy if exists study_resource_topics_read on study_resource_topics;
create policy study_resource_topics_read on study_resource_topics for select using (study_resource_visible(resource_id));
drop policy if exists study_resource_topics_insert on study_resource_topics;
create policy study_resource_topics_insert on study_resource_topics for insert
  with check (exists (select 1 from study_resources r where r.id = resource_id and r.added_by = app_user()
                      and study_open(r.group_id) and not app_admin_viewing()));
drop policy if exists study_resource_topics_delete on study_resource_topics;
create policy study_resource_topics_delete on study_resource_topics for delete
  using (exists (select 1 from study_resources r where r.id = resource_id and r.added_by = app_user()
                 and study_open(r.group_id) and not app_admin_viewing()));

grant select, insert, delete on study_resources, study_resource_topics to bottega_app;
grant update (title, why) on study_resources to bottega_app;
grant update (resource_id, position_s) on study_notes to bottega_app;
grant update (resource_id) on study_sessions to bottega_app;
grant usage on all sequences in schema public to bottega_app;

revoke execute on function study_resource_publish(bigint) from public;
grant execute on function study_resource_publish(bigint) to bottega_app;

commit;

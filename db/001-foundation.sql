-- 001: Phase 0 foundation. People, projects of every kind, music projects,
-- collections, parts, audio, notes, genres.
--
-- Safe to run twice (if not exists, or replace), as pipeline/migrate.py
-- requires. The runner strips the leading begin and trailing commit and supplies
-- its own transaction; they stay so the file can be pasted into a console.
--
-- Projects are one shared table plus one table per kind (ARCHITECTURE.md §4).
-- A kind table carries the kind as a constant column and a composite foreign
-- key to projects (id, kind), so a music_projects row can only belong to a
-- project whose kind is 'music'.

begin;

-- People -------------------------------------------------------------------

create table if not exists artists (
  id    bigint generated always as identity primary key,
  code  text not null unique check (code <> '' and code = upper(btrim(code))),
  name  text not null unique check (name <> '' and name = btrim(name))
);

-- Who a signed-in person is within the studio. ALLOWED_EMAILS decides access;
-- this decides attribution.
create table if not exists members (
  email         text primary key check (email <> '' and email = lower(btrim(email))),
  display_name  text not null default '',
  artist_id     bigint references artists(id)
);

-- Genres ---------------------------------------------------------------------

create table if not exists genres (
  name  text primary key check (name <> '' and name = btrim(name))
);
create unique index if not exists genres_name_ci on genres (lower(name));

-- Projects -------------------------------------------------------------------

create table if not exists projects (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('music', 'installation', 'multimedia', 'collection')),
  title       text not null default '' check (title = btrim(title)),
  rating      smallint not null default 0 check (rating between 0 and 5),
  created_by  text not null,
  created_at  timestamptz not null default now(),
  unique (id, kind)
);
create index if not exists projects_kind_idx on projects (kind);

-- Every title a project has had, newest last. From Vivarium's
-- studio_project_names.
create table if not exists project_titles (
  id          bigint generated always as identity primary key,
  project_id  bigint not null references projects(id) on delete cascade,
  title       text not null,
  set_by      text not null,
  set_at      timestamptz not null default now()
);
create index if not exists project_titles_project_idx on project_titles (project_id, set_at desc);

-- Music projects: one Ableton Live session each.
create table if not exists music_projects (
  project_id      bigint primary key,
  kind            text not null default 'music' check (kind = 'music'),
  artist_id       bigint not null references artists(id),
  canonical_id    text not null check (canonical_id <> '' and canonical_id = btrim(canonical_id)),
  genre           text references genres(name) on update cascade,
  bpm             numeric(5,2) check (bpm is null or bpm between 20 and 400),
  current_mix_id  bigint,   -- foreign key added below, after audio
  foreign key (project_id, kind) references projects(id, kind) on delete cascade,
  unique (artist_id, canonical_id)
);

-- The canonical ID is the date prefix of the Ableton folder. Renaming breaks
-- Ableton's file associations, so it can never change.
create or replace function music_projects_lock_canonical() returns trigger
language plpgsql as $body$
begin
  if new.canonical_id is distinct from old.canonical_id then
    raise exception 'music_projects.canonical_id is permanent (project %: "%" cannot become "%")',
      old.project_id, old.canonical_id, new.canonical_id;
  end if;
  return new;
end;
$body$;
drop trigger if exists music_projects_lock_canonical on music_projects;
create trigger music_projects_lock_canonical
  before update of canonical_id on music_projects
  for each row execute function music_projects_lock_canonical();

-- Collections: EP, LP, single, compilation, multi-part composition. From
-- Vivarium's studio_releases, whose 'album' becomes 'lp'.
create table if not exists collections (
  project_id  bigint primary key,
  kind        text not null default 'collection' check (kind = 'collection'),
  form        text not null check (form in ('ep', 'lp', 'single', 'compilation', 'multipart', 'other')),
  artist_id   bigint references artists(id),   -- null: various, or not decided
  year        int check (year is null or year between 1900 and 2200),
  notes       text not null default '',
  foreign key (project_id, kind) references projects(id, kind) on delete cascade
);

-- Parts -------------------------------------------------------------------------

-- Which projects make up a larger one, in order: the tracks of an EP, the
-- movements of a composition, the soundtrack of an installation. A project can
-- be a part of several parents, at its own position in each.
create table if not exists project_parts (
  parent_id  bigint not null references projects(id) on delete cascade,
  child_id   bigint not null references projects(id) on delete cascade,
  position   int not null check (position > 0),
  primary key (parent_id, child_id),
  check (parent_id <> child_id)
);
create index if not exists project_parts_child_idx on project_parts (child_id);

-- A music project has no parts, and no project may contain itself through
-- others. The walk uses union, not union all, so it ends even if a cycle
-- already exists.
create or replace function project_parts_check() returns trigger
language plpgsql as $body$
begin
  if (select kind from projects where id = new.parent_id) = 'music' then
    raise exception 'project % is a music project and cannot have parts', new.parent_id;
  end if;
  if exists (
    with recursive below(id) as (
      select new.child_id
      union
      select pp.child_id from project_parts pp join below b on pp.parent_id = b.id
    )
    select 1 from below where id = new.parent_id
  ) then
    raise exception 'project % cannot contain project %: it would contain itself',
      new.parent_id, new.child_id;
  end if;
  return new;
end;
$body$;
drop trigger if exists project_parts_check on project_parts;
create trigger project_parts_check
  before insert or update on project_parts
  for each row execute function project_parts_check();

-- Audio ------------------------------------------------------------------------

-- Mixes are the producers' own bounces, numbered per project. References are
-- other artists' tracks, unnumbered, credited.
create table if not exists audio (
  id                 bigint generated always as identity primary key,
  project_id         bigint not null references projects(id) on delete cascade,
  role               text not null check (role in ('mix', 'reference')),
  version            int check (version is null or version > 0),
  r2_key             text not null unique,
  original_filename  text not null,
  bytes              bigint,
  duration_s         real check (duration_s is null or duration_s >= 0),
  credit             text not null default '',
  uploaded_by        text not null,
  uploaded_at        timestamptz not null default now(),
  check ((role = 'mix') = (version is not null)),
  unique (project_id, version)
);
create index if not exists audio_project_idx on audio (project_id, role, uploaded_at desc);

do $body$
begin
  if not exists (select 1 from pg_constraint where conname = 'music_projects_current_mix_fkey') then
    alter table music_projects
      add constraint music_projects_current_mix_fkey
      foreign key (current_mix_id) references audio(id) on delete set null;
  end if;
end;
$body$;

-- The current mix must be a mix of the same project. Null means the newest.
create or replace function music_projects_current_mix_check() returns trigger
language plpgsql as $body$
begin
  if new.current_mix_id is not null and not exists (
    select 1 from audio a
    where a.id = new.current_mix_id and a.project_id = new.project_id and a.role = 'mix'
  ) then
    raise exception 'audio % is not a mix of project %', new.current_mix_id, new.project_id;
  end if;
  return new;
end;
$body$;
drop trigger if exists music_projects_current_mix_check on music_projects;
create trigger music_projects_current_mix_check
  before insert or update of current_mix_id on music_projects
  for each row execute function music_projects_current_mix_check();

-- Notes -------------------------------------------------------------------------

-- origin, reviewed and rejected_at arrive now so that connector proposals
-- (Phase 1) need no change here. A person's note is human and reviewed.
create table if not exists notes (
  id           bigint generated always as identity primary key,
  project_id   bigint not null references projects(id) on delete cascade,
  audio_id     bigint references audio(id) on delete set null,
  author       text not null,
  body         text not null check (btrim(body) <> ''),
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  origin       text not null default 'human' check (origin in ('human', 'assistant')),
  reviewed     boolean not null default true,
  rejected_at  timestamptz
);
create index if not exists notes_project_idx on notes (project_id, created_at desc);

commit;

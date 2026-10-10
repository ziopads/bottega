-- 002: Accounts and access. REQUIREMENTS §2 (AC-1 to AC-12), ARCHITECTURE §11.
--
-- Bottega becomes a platform of separate accounts. Every project belongs to
-- one account; other people see it only when its owner shares it with them;
-- the database itself enforces that, so a query that forgets to filter
-- returns nothing from other accounts.
--
-- BEFORE RUNNING
--
--   Create the application's role in the Neon SQL Editor, as the owner role:
--
--     create role bottega_app with login password '<a long random password>';
--
--   With SQL, not the Console: roles made in the Console join neon_superuser,
--   which carries BYPASSRLS on projects created after August 2023. This file
--   refuses to run if the role is missing or can bypass row-level security.
--
-- WHAT IT CHANGES, AND WHAT IT DOES NOT
--
--   Production keeps connecting as the owner role until DATABASE_URL is
--   switched to bottega_app (ARCHITECTURE §11, cutover step 5). The owner owns
--   every table and so is not subject to the policies below: running this
--   file changes nothing the live app can see.
--
--   Existing projects have no owner until pipeline/bootstrap.py assigns them.
--   Rows without an owner are invisible to bottega_app.
--
-- HOW THE CURRENT PERSON REACHES THE DATABASE
--
--   The app runs every statement in a transaction that first calls
--   set_config('app.user_id', <Neon Auth user id>, true). app_user() reads it.
--   A value set that way is local to the transaction; afterwards the setting
--   reads as '' on that connection, which app_user() treats as nobody.
--
-- WHY THE LEVEL FUNCTIONS ARE SECURITY DEFINER
--
--   A policy on projects that asks "may this person see project 7?" has to
--   read projects, shares and project_parts. Run as bottega_app, that read
--   would itself be filtered by the policy being evaluated. The functions run
--   as the owner, read the tables unfiltered, and answer only about the
--   current person. search_path is pinned so they cannot be redirected.
--
-- Safe to run twice, as pipeline/migrate.py requires.

begin;

-- The application role ---------------------------------------------------------

do $body$
declare r record;
begin
  select rolsuper, rolbypassrls into r from pg_roles where rolname = 'bottega_app';
  if not found then
    raise exception 'role bottega_app does not exist. Create it first in the Neon SQL Editor: create role bottega_app with login password ''...'';';
  end if;
  if r.rolsuper or r.rolbypassrls then
    raise exception 'role bottega_app can bypass row-level security (superuser or BYPASSRLS). Drop it and create it with SQL, not in the Console.';
  end if;
  if pg_has_role('bottega_app', 'neon_superuser', 'member') then
    raise exception 'role bottega_app is a member of neon_superuser. Drop it and create it with SQL, not in the Console.';
  end if;
exception
  when undefined_object then null;  -- no neon_superuser role (a local Postgres): nothing to check
end;
$body$;

-- Accounts ----------------------------------------------------------------------

create table if not exists accounts (
  user_id            text primary key check (user_id <> ''),
  email              text not null unique check (email <> '' and email = lower(btrim(email))),
  display_name       text not null default '',
  status             text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  is_platform_admin  boolean not null default false,
  created_at         timestamptz not null default now(),
  approved_at        timestamptz,
  approved_by        text references accounts(user_id)
);

-- Who is asking. Null when no person is set, which every policy reads as nobody.
create or replace function app_user() returns text
language sql stable as $body$
  select nullif(current_setting('app.user_id', true), '')
$body$;

-- The actor recorded in the access log: the person, or a label the owner-role
-- tools set (bootstrap.py sets 'bootstrap'), or 'owner role'.
create or replace function app_actor() returns text
language sql stable as $body$
  select coalesce(app_user(), nullif(current_setting('app.actor', true), ''), 'owner role')
$body$;

create or replace function app_active() returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select exists (select 1 from accounts where user_id = app_user() and status = 'active')
$body$;

create or replace function app_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select exists (
    select 1 from accounts where user_id = app_user() and status = 'active' and is_platform_admin
  )
$body$;

-- The platform administrator's read-only view of other accounts (AC-9). Only
-- requests the app marks with app.admin_view = 'on' get it, and only reads.
create or replace function app_admin_viewing() returns boolean
language sql stable as $body$
  select current_setting('app.admin_view', true) = 'on' and app_is_admin()
$body$;

-- The access log ------------------------------------------------------------------

create table if not exists access_log (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor         text not null,               -- an accounts.user_id, 'bootstrap', or 'owner role'
  action        text not null,
  subject_id    text,                        -- the account concerned, when there is one
  item_kind     text,                        -- 'project' and later 'gear', 'document', 'study_group'
  item_id       bigint,
  before        jsonb,
  after         jsonb,
  reason        text
);
create index if not exists access_log_at_idx on access_log (at desc);
create index if not exists access_log_subject_idx on access_log (subject_id, at desc);
create index if not exists access_log_actor_idx on access_log (actor, at desc);
create index if not exists access_log_item_idx on access_log (item_kind, item_id);

-- Entries are permanent: no update, no delete, no truncate, for anyone.
create or replace function access_log_immutable() returns trigger
language plpgsql as $body$
begin
  raise exception 'access_log is append-only: entries cannot be changed or removed';
end;
$body$;
drop trigger if exists access_log_no_update on access_log;
create trigger access_log_no_update before update or delete on access_log
  for each row execute function access_log_immutable();
drop trigger if exists access_log_no_truncate on access_log;
create trigger access_log_no_truncate before truncate on access_log
  for each statement execute function access_log_immutable();

-- Internal: every log entry goes through here. Not granted to the app.
create or replace function log_access(
  p_action text, p_subject text, p_item_kind text, p_item_id bigint,
  p_before jsonb, p_after jsonb, p_reason text
) returns void
language sql security definer set search_path = public, pg_temp as $body$
  insert into access_log (actor, action, subject_id, item_kind, item_id, before, after, reason)
  values (app_actor(), p_action, p_subject, p_item_kind, p_item_id, p_before, p_after,
          coalesce(p_reason, nullif(current_setting('app.reason', true), '')))
$body$;

-- Changes to accounts log themselves, whichever code path makes them.
create or replace function accounts_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  watched_old jsonb;
  watched_new jsonb;
begin
  if tg_op = 'INSERT' then
    perform log_access('account_created', new.user_id, null, null, null,
      jsonb_build_object('email', new.email, 'status', new.status, 'is_platform_admin', new.is_platform_admin), null);
    return new;
  end if;
  watched_old := jsonb_build_object('email', old.email, 'status', old.status, 'is_platform_admin', old.is_platform_admin);
  watched_new := jsonb_build_object('email', new.email, 'status', new.status, 'is_platform_admin', new.is_platform_admin);
  if watched_old is distinct from watched_new then
    perform log_access('account_changed', new.user_id, null, null, watched_old, watched_new, null);
  end if;
  return new;
end;
$body$;
drop trigger if exists accounts_log on accounts;
create trigger accounts_log after insert or update on accounts
  for each row execute function accounts_log();

-- Called by the app on every signed-in request. Creates the account as
-- pending the first time this person is seen (AC-1), keeps email and name
-- current, and returns what the app needs to route them.
create or replace function register_session(p_email text, p_name text)
returns table (status text, is_platform_admin boolean)
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  e text := lower(btrim(p_email));
  n text := btrim(coalesce(p_name, ''));
begin
  if me is null then
    raise exception 'register_session needs app.user_id';
  end if;
  insert into accounts (user_id, email, display_name) values (me, e, n)
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = case when accounts.display_name = '' then excluded.display_name else accounts.display_name end
    where accounts.email is distinct from excluded.email
       or (accounts.display_name = '' and excluded.display_name <> '');
  return query select a.status, a.is_platform_admin from accounts a where a.user_id = me;
end;
$body$;

-- The platform administrator approves, disables, re-enables, and grants or
-- withdraws administration (AC-2). The last active administrator cannot be
-- removed or disabled, so the platform cannot lock itself out.
create or replace function admin_set_account(
  p_user_id text, p_status text, p_is_admin boolean, p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  cur accounts;
begin
  if not app_is_admin() then
    raise exception 'only the platform administrator can change accounts';
  end if;
  select * into cur from accounts where user_id = p_user_id;
  if not found then
    raise exception 'no account %', p_user_id;
  end if;
  if p_status not in ('pending', 'active', 'disabled') then
    raise exception 'unknown status %', p_status;
  end if;
  if cur.is_platform_admin and cur.status = 'active'
     and (p_status <> 'active' or not p_is_admin)
     and (select count(*) from accounts where is_platform_admin and status = 'active') = 1 then
    raise exception 'that is the last active platform administrator';
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update accounts
     set status = p_status,
         is_platform_admin = p_is_admin,
         approved_at = case when cur.status <> 'active' and p_status = 'active' then now() else approved_at end,
         approved_by = case when cur.status <> 'active' and p_status = 'active' then app_user() else approved_by end
   where user_id = p_user_id;
end;
$body$;

-- Events the app reports that no table change captures (AC-11). The action
-- list is closed, and the actor is always the current person.
create or replace function log_event(
  p_action text, p_subject text, p_item_kind text, p_item_id bigint, p_detail jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if app_user() is null or not exists (select 1 from accounts where user_id = app_user()) then
    raise exception 'log_event needs a signed-in account';
  end if;
  if p_action not in ('password_changed', 'token_issued', 'token_revoked', 'admin_view') then
    raise exception 'log_event does not record %', p_action;
  end if;
  if p_action = 'admin_view' and not app_is_admin() then
    raise exception 'only the platform administrator records admin views';
  end if;
  perform log_access(p_action, coalesce(p_subject, app_user()), p_item_kind, p_item_id, null, p_detail, null);
end;
$body$;

-- An owner looking up a person to share with, by email. Active accounts only;
-- returns the id and name, nothing else.
create or replace function find_account(p_email text)
returns table (user_id text, display_name text)
language sql stable security definer set search_path = public, pg_temp as $body$
  select a.user_id, a.display_name from accounts a
  where app_active() and a.status = 'active' and a.email = lower(btrim(p_email))
$body$;

-- Names (never emails) for accounts the app needs to show: an item's owner,
-- the people it is shared with, a note's author.
create or replace function account_names(p_ids text[])
returns table (user_id text, display_name text)
language sql stable security definer set search_path = public, pg_temp as $body$
  select a.user_id, a.display_name from accounts a
  where app_active() and a.user_id = any(p_ids)
$body$;

-- Ownership ----------------------------------------------------------------------

alter table projects add column if not exists owner_id text references accounts(user_id);
alter table projects alter column owner_id set default app_user();
alter table projects add column if not exists created_by_id text references accounts(user_id);
alter table projects alter column created_by_id set default app_user();
create index if not exists projects_owner_idx on projects (owner_id);

alter table artists add column if not exists account_id text references accounts(user_id);
alter table artists alter column account_id set default app_user();
create index if not exists artists_account_idx on artists (account_id);

alter table audio add column if not exists uploaded_by_id text references accounts(user_id);
alter table audio alter column uploaded_by_id set default app_user();

alter table notes add column if not exists author_id text references accounts(user_id);
alter table notes alter column author_id set default app_user();

alter table project_titles add column if not exists set_by_id text references accounts(user_id);
alter table project_titles alter column set_by_id set default app_user();

-- Shares -------------------------------------------------------------------------

-- One row per item, person and level (AC-5). One nullable foreign key per
-- kind of item; gear_id and document_id arrive with their tables, and the
-- check below is widened then.
create table if not exists shares (
  id          bigint generated always as identity primary key,
  project_id  bigint references projects(id) on delete cascade,
  grantee_id  text not null references accounts(user_id) on delete cascade,
  level       text not null check (level in ('view', 'contribute', 'edit')),
  granted_by  text not null default app_actor(),
  granted_at  timestamptz not null default now(),
  constraint shares_one_item check (num_nonnulls(project_id) = 1)
);
create unique index if not exists shares_project_grantee on shares (project_id, grantee_id) where project_id is not null;
create index if not exists shares_grantee_idx on shares (grantee_id);

-- Effective level ------------------------------------------------------------------

-- 4 owner, 3 edit, 2 contribute, 1 view, 0 nothing (ARCHITECTURE §11).
create or replace function level_rank(p_level text) returns int
language sql immutable as $body$
  select case p_level when 'owner' then 4 when 'edit' then 3 when 'contribute' then 2 when 'view' then 1 else 0 end
$body$;

create or replace function project_rank(p_project_id bigint) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  owner text;
  best int := 0;
begin
  if me is null or not app_active() then
    return 0;
  end if;
  select owner_id into owner from projects where id = p_project_id;
  if not found then
    return 0;
  end if;
  if owner = me then
    return 4;
  end if;
  select coalesce(max(level_rank(level)), 0) into best
  from shares where project_id = p_project_id and grantee_id = me;
  -- AC-6: a share on a collection above this project gives view, walking up
  -- only through parents with the same owner, so a collection cannot pass on
  -- access to someone else's track.
  if best < 1 and owner is not null and exists (
    with recursive up(id) as (
      select pp.parent_id from project_parts pp
        join projects par on par.id = pp.parent_id
       where pp.child_id = p_project_id and par.owner_id = owner
      union
      select pp.parent_id from project_parts pp
        join up on pp.child_id = up.id
        join projects par on par.id = pp.parent_id
       where par.owner_id = owner
    )
    select 1 from up join shares s on s.project_id = up.id and s.grantee_id = me
  ) then
    best := 1;
  end if;
  if best < 1 and app_admin_viewing() then
    best := 1;
  end if;
  return best;
end;
$body$;

create or replace function project_level(p_project_id bigint) returns text
language sql stable as $body$
  select case project_rank(p_project_id) when 4 then 'owner' when 3 then 'edit'
         when 2 then 'contribute' when 1 then 'view' else null end
$body$;

-- Consistency triggers ----------------------------------------------------------

-- A project is credited only to an artist of its owner's account. Checked
-- after the statement's rows exist, so the insert into projects and into
-- music_projects can stay one statement (lib/studio.ts createProject).
create or replace function credit_artist_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  proj_owner text;
  artist_owner text;
begin
  if new.artist_id is null then
    return null;
  end if;
  select owner_id into proj_owner from projects where id = new.project_id;
  select account_id into artist_owner from artists where id = new.artist_id;
  if proj_owner is distinct from artist_owner then
    raise exception 'artist % belongs to another account than project %', new.artist_id, new.project_id;
  end if;
  return null;
end;
$body$;
drop trigger if exists music_projects_credit_check on music_projects;
create constraint trigger music_projects_credit_check
  after insert or update of artist_id on music_projects
  for each row execute function credit_artist_check();
drop trigger if exists collections_credit_check on collections;
create constraint trigger collections_credit_check
  after insert or update of artist_id on collections
  for each row execute function credit_artist_check();

-- The kind row of a project the person does not own cannot be inserted. The
-- insert policy cannot see a project inserted earlier in the same statement,
-- so this check runs after the statement instead.
create or replace function kind_row_owner_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if app_user() is not null
     and (select owner_id from projects where id = new.project_id) is distinct from app_user() then
    raise exception 'project % belongs to another account', new.project_id;
  end if;
  return null;
end;
$body$;
drop trigger if exists music_projects_owner_check on music_projects;
create constraint trigger music_projects_owner_check
  after insert on music_projects
  for each row execute function kind_row_owner_check();
drop trigger if exists collections_owner_check on collections;
create constraint trigger collections_owner_check
  after insert on collections
  for each row execute function kind_row_owner_check();

-- Shares log themselves (AC-11), and nobody shares with themselves or with an
-- account that is not active.
create or replace function shares_check_and_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  item_owner text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select owner_id into item_owner from projects where id = new.project_id;
    if new.grantee_id = item_owner then
      raise exception 'an owner cannot share an item with themselves';
    end if;
    if not exists (select 1 from accounts where user_id = new.grantee_id and status = 'active') then
      raise exception 'account % is not active', new.grantee_id;
    end if;
  end if;
  if tg_op = 'INSERT' then
    perform log_access('share_granted', new.grantee_id, 'project', new.project_id, null,
      jsonb_build_object('level', new.level), null);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.level is distinct from new.level then
      perform log_access('share_changed', new.grantee_id, 'project', new.project_id,
        jsonb_build_object('level', old.level), jsonb_build_object('level', new.level), null);
    end if;
    return new;
  else
    perform log_access('share_revoked', old.grantee_id, 'project', old.project_id,
      jsonb_build_object('level', old.level), null, null);
    return old;
  end if;
end;
$body$;
drop trigger if exists shares_check on shares;
create trigger shares_check before insert or update on shares
  for each row execute function shares_check_and_log();
drop trigger if exists shares_log_delete on shares;
create trigger shares_log_delete after delete on shares
  for each row execute function shares_check_and_log();

-- 001's checks read other rows. Run as the app role they would see only what
-- the policies allow, and a cycle through a collection the person cannot see
-- would go undetected. They run as the owner instead.
alter function project_parts_check() security definer set search_path = public, pg_temp;
alter function music_projects_current_mix_check() security definer set search_path = public, pg_temp;

-- Row-level security ----------------------------------------------------------------

alter table accounts       enable row level security;
alter table access_log     enable row level security;
alter table artists        enable row level security;
alter table members        enable row level security;
alter table genres         enable row level security;
alter table projects       enable row level security;
alter table project_titles enable row level security;
alter table music_projects enable row level security;
alter table collections    enable row level security;
alter table project_parts  enable row level security;
alter table audio          enable row level security;
alter table notes          enable row level security;
alter table shares         enable row level security;

-- accounts: yourself; the administrator sees everyone. Written only through
-- the functions above.
drop policy if exists accounts_read on accounts;
create policy accounts_read on accounts for select
  using (user_id = app_user() or app_is_admin());

-- access_log: entries that concern you or your items; the administrator, all.
drop policy if exists access_log_read on access_log;
create policy access_log_read on access_log for select
  using (
    app_is_admin()
    or (app_active() and (
      actor = app_user() or subject_id = app_user()
      or (item_kind = 'project' and project_rank(item_id) = 4)
    ))
  );

-- artists: your own, and any artist credited on a project you can see.
drop policy if exists artists_read on artists;
create policy artists_read on artists for select
  using (
    app_active() and (
      account_id = app_user()
      or exists (select 1 from music_projects m where m.artist_id = artists.id and project_rank(m.project_id) > 0)
      or exists (select 1 from collections c where c.artist_id = artists.id and project_rank(c.project_id) > 0)
    )
  );
drop policy if exists artists_write on artists;
create policy artists_write on artists for insert
  with check (app_active() and account_id = app_user());
drop policy if exists artists_update on artists;
create policy artists_update on artists for update
  using (app_active() and account_id = app_user())
  with check (account_id = app_user());
drop policy if exists artists_delete on artists;
create policy artists_delete on artists for delete
  using (app_active() and account_id = app_user());

-- members: Phase 0's attribution table, kept until lib/studio.ts stops
-- reading it. Your own row only; the administrator, all.
drop policy if exists members_read on members;
create policy members_read on members for select
  using (app_active() and (email = (select a.email from accounts a where a.user_id = app_user()) or app_is_admin()));

-- genres: one list for the platform (REQUIREMENTS §15, decision 7).
drop policy if exists genres_read on genres;
create policy genres_read on genres for select using (app_active());
drop policy if exists genres_add on genres;
create policy genres_add on genres for insert with check (app_active());

-- projects. The owner test on the row's own column comes first, so a row
-- inserted earlier in the same statement (createProject's CTE) passes
-- without a lookup that could not yet see it.
drop policy if exists projects_read on projects;
create policy projects_read on projects for select
  using ((owner_id = app_user() and app_active()) or project_rank(id) > 0);
drop policy if exists projects_insert on projects;
create policy projects_insert on projects for insert
  with check (app_active() and owner_id = app_user());
drop policy if exists projects_update on projects;
create policy projects_update on projects for update
  using (project_rank(id) >= 3 and not app_admin_viewing())
  with check (project_rank(id) >= 3);
drop policy if exists projects_delete on projects;
create policy projects_delete on projects for delete
  using (owner_id = app_user() and app_active());

drop policy if exists project_titles_read on project_titles;
create policy project_titles_read on project_titles for select
  using (project_rank(project_id) > 0);
drop policy if exists project_titles_insert on project_titles;
create policy project_titles_insert on project_titles for insert
  with check (project_rank(project_id) >= 3 and set_by_id = app_user());

-- The kind tables follow their project. Inserts are checked by
-- kind_row_owner_check after the statement.
drop policy if exists music_projects_read on music_projects;
create policy music_projects_read on music_projects for select
  using (project_rank(project_id) > 0);
drop policy if exists music_projects_insert on music_projects;
create policy music_projects_insert on music_projects for insert
  with check (app_active());
drop policy if exists music_projects_update on music_projects;
create policy music_projects_update on music_projects for update
  using (project_rank(project_id) >= 3 and not app_admin_viewing())
  with check (project_rank(project_id) >= 3);

drop policy if exists collections_read on collections;
create policy collections_read on collections for select
  using (project_rank(project_id) > 0);
drop policy if exists collections_insert on collections;
create policy collections_insert on collections for insert
  with check (app_active());
drop policy if exists collections_update on collections;
create policy collections_update on collections for update
  using (project_rank(project_id) >= 3 and not app_admin_viewing())
  with check (project_rank(project_id) >= 3);

-- project_parts: readable with the parent. Editing the running order needs
-- edit on the parent and sight of the child; taking a part off is a deletion,
-- so the parent's owner only (AC-7).
drop policy if exists project_parts_read on project_parts;
create policy project_parts_read on project_parts for select
  using (project_rank(parent_id) > 0);
drop policy if exists project_parts_insert on project_parts;
create policy project_parts_insert on project_parts for insert
  with check (project_rank(parent_id) >= 3 and project_rank(child_id) >= 1 and not app_admin_viewing());
drop policy if exists project_parts_update on project_parts;
create policy project_parts_update on project_parts for update
  using (project_rank(parent_id) >= 3 and not app_admin_viewing())
  with check (project_rank(parent_id) >= 3);
drop policy if exists project_parts_delete on project_parts;
create policy project_parts_delete on project_parts for delete
  using (project_rank(parent_id) = 4);

-- audio: contributors upload; only the owner deletes.
drop policy if exists audio_read on audio;
create policy audio_read on audio for select
  using (project_rank(project_id) > 0);
drop policy if exists audio_insert on audio;
create policy audio_insert on audio for insert
  with check (project_rank(project_id) >= 2 and uploaded_by_id = app_user() and not app_admin_viewing());
drop policy if exists audio_update on audio;
create policy audio_update on audio for update
  using (project_rank(project_id) >= 2 and not app_admin_viewing())
  with check (project_rank(project_id) >= 2);
drop policy if exists audio_delete on audio;
create policy audio_delete on audio for delete
  using (project_rank(project_id) = 4);

-- notes: contributors write their own; authors edit their own; only the
-- owner deletes.
drop policy if exists notes_read on notes;
create policy notes_read on notes for select
  using (project_rank(project_id) > 0);
drop policy if exists notes_insert on notes;
create policy notes_insert on notes for insert
  with check (project_rank(project_id) >= 2 and author_id = app_user() and not app_admin_viewing());
drop policy if exists notes_update on notes;
create policy notes_update on notes for update
  using (author_id = app_user() and project_rank(project_id) >= 1 and not app_admin_viewing())
  with check (author_id = app_user());
drop policy if exists notes_delete on notes;
create policy notes_delete on notes for delete
  using (project_rank(project_id) = 4);

-- shares: the item's owner manages them; the grantee sees their own.
drop policy if exists shares_read on shares;
create policy shares_read on shares for select
  using (app_active() and (grantee_id = app_user() or project_rank(project_id) = 4));
drop policy if exists shares_insert on shares;
create policy shares_insert on shares for insert
  with check (project_rank(project_id) = 4 and granted_by = app_user());
drop policy if exists shares_update on shares;
create policy shares_update on shares for update
  using (project_rank(project_id) = 4)
  with check (project_rank(project_id) = 4);
drop policy if exists shares_delete on shares;
create policy shares_delete on shares for delete
  using (project_rank(project_id) = 4);

-- Grants to the application role ------------------------------------------------------

grant usage on schema public to bottega_app;

-- Reads, everywhere the policies allow.
grant select on accounts, access_log, artists, members, genres, projects, project_titles,
  music_projects, collections, project_parts, audio, notes, shares to bottega_app;

-- Writes, column by column where only some columns may change. Ownership,
-- authorship and storage keys are never updatable from the app.
grant insert on artists, genres, projects, project_titles, music_projects, collections,
  project_parts, audio, notes, shares to bottega_app;
grant update (code, name) on artists to bottega_app;
grant update (title, rating) on projects to bottega_app;
grant update (genre, bpm, artist_id, current_mix_id) on music_projects to bottega_app;
grant update (form, artist_id, year, notes) on collections to bottega_app;
grant update (position) on project_parts to bottega_app;
grant update (credit, duration_s) on audio to bottega_app;
grant update (body, audio_id, edited_at) on notes to bottega_app;
grant update (level) on shares to bottega_app;
grant delete on artists, projects, project_parts, audio, notes, shares to bottega_app;

grant usage on all sequences in schema public to bottega_app;

-- Functions: the internal ones are not callable from the app.
revoke execute on function log_access(text, text, text, bigint, jsonb, jsonb, text) from public;
revoke execute on function admin_set_account(text, text, boolean, text) from public;
revoke execute on function register_session(text, text) from public;
revoke execute on function log_event(text, text, text, bigint, jsonb) from public;
revoke execute on function find_account(text) from public;
revoke execute on function account_names(text[]) from public;
grant execute on function admin_set_account(text, text, boolean, text) to bottega_app;
grant execute on function register_session(text, text) to bottega_app;
grant execute on function log_event(text, text, text, bigint, jsonb) to bottega_app;
grant execute on function find_account(text) to bottega_app;
grant execute on function account_names(text[]) to bottega_app;

commit;

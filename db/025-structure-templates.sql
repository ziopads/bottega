-- 025 — Track structure templates (REQUIREMENTS W-25 to W-29; decided 23
-- October 2026): the zones a Live set's tracks are sorted into, the parts
-- under each, and the elements that are not track zones (STRUCTURE, BUS),
-- per account, as 024 did for workflow stages.
--
--   - structure_templates, structure_elements: a template's element tree. A
--     top-level element is a zone (is_zone) or not; a zone has prefixes (a
--     track named "TAC Kick" belongs to the zone with prefix TAC) and group
--     names (a track inside a group named "Drums" belongs to the zone listing
--     Drums). Each element keeps a uid across copies. The platform default is
--     the Sirsinate Live template (docs/ableton-session-template.md) with the
--     colours the State tab used. structure_copy() makes an account's copy;
--     every change raises the template's version.
--   - account_preferences.structure_template_id: the structure new projects
--     take; account_structure() falls back to the default.
--   - elements (011), each project's own tree, gains description, colour,
--     is_zone, prefixes, group_names and template_uid; project_structure
--     records the template and version a project took. structure_start()
--     copies the owner's structure and is called by workflow_start() for music
--     (the app copied lib/elementTemplate.ts until now). Projects with
--     elements already are matched to the default by name.
--   - project_zones(): the zones a project's sets are read with: its own once
--     it has elements, before that its owner's structure. Matching happens
--     when a set is read for display, so a changed mapping applies to every
--     set already stored.
--   - structure_template_status(), structure_template_elements() and
--     structure_apply() offer a project the changes its template has had.
--
-- Requires 024. Safe to run twice.

begin;

create table if not exists structure_templates (
  id           bigint generated always as identity primary key,
  owner_id     text references accounts(user_id) on delete cascade,
  name         text not null check (name = btrim(name) and name <> '' and char_length(name) <= 80),
  copied_from  bigint references structure_templates(id) on delete set null,
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists structure_templates_name_idx on structure_templates (coalesce(owner_id, ''), lower(name));
create unique index if not exists structure_templates_default_idx on structure_templates ((true)) where owner_id is null;

-- A list of matchers: each trimmed, 1 to 40 characters, no two alike.
create or replace function matchers_ok(a text[]) returns boolean
language sql immutable as $body$
  select coalesce(bool_and(x = btrim(x) and char_length(x) between 1 and 40), true)
     and cardinality(a) = (select count(distinct lower(y)) from unnest(a) y)
     and cardinality(a) <= 20
    from unnest(a) x
$body$;

create table if not exists structure_elements (
  id           bigint generated always as identity primary key,
  template_id  bigint not null references structure_templates(id) on delete cascade,
  parent_id    bigint references structure_elements(id) on delete cascade,
  uid          uuid not null default gen_random_uuid(),
  position     int not null default 0,
  name         text not null check (name = btrim(name) and name <> '' and char_length(name) <= 80),
  description  text not null default '' check (char_length(description) <= 300),
  color        text check (color ~ '^#[0-9a-f]{6}$'),
  is_zone      boolean not null default false,
  prefixes     text[] not null default '{}' check (matchers_ok(prefixes)),
  group_names  text[] not null default '{}' check (matchers_ok(group_names)),
  -- Only a top-level element is a zone, and only a zone matches tracks.
  check (is_zone or (cardinality(prefixes) = 0 and cardinality(group_names) = 0))
);
create index if not exists structure_elements_template_idx on structure_elements (template_id, parent_id, position);

create or replace function structure_owner(p_template bigint) returns text
language sql stable security definer set search_path = public, pg_temp as $body$
  select owner_id from structure_templates where id = p_template
$body$;

-- A part sits under a top-level element of the same template; a part is no
-- zone. Any change raises the template's version.
create or replace function structure_elements_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if tg_op = 'UPDATE' and (new.template_id <> old.template_id or new.uid <> old.uid) then
    raise exception 'an element stays with its template';
  end if;
  if new.parent_id is not null then
    if not exists (select 1 from structure_elements where id = new.parent_id and template_id = new.template_id and parent_id is null) then
      raise exception 'a part sits under a top-level element of the same template';
    end if;
    if new.is_zone then
      raise exception 'only a top-level element is a zone';
    end if;
  end if;
  return new;
end;
$body$;
drop trigger if exists structure_elements_check on structure_elements;
create trigger structure_elements_check before insert or update on structure_elements
  for each row execute function structure_elements_check();

create or replace function structure_bump() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  update structure_templates set version = version + 1, updated_at = now()
   where id = coalesce(new.template_id, old.template_id);
  return null;
end;
$body$;
drop trigger if exists structure_elements_bump on structure_elements;
create trigger structure_elements_bump after insert or update or delete on structure_elements
  for each row execute function structure_bump();

-- The platform default: the Sirsinate Live template.
do $seed$
declare
  t bigint;
  e bigint;
  z record;
  part text;
  i int;
begin
  if exists (select 1 from structure_templates where owner_id is null) then
    return;
  end if;
  insert into structure_templates (name) values ('Bottega default') returning id into t;
  for z in
    select * from (values
      (1, 'TACTUS', 'The pulse: drums and percussion that carry the beat.', '#b5543c', true, array['TAC'], array['Kick', 'Snare and clap', 'Hats', 'Percussion']),
      (2, 'BASS', 'The low end.', '#3d5a80', true, array['BAS'], array['Sub', 'Bass']),
      (3, 'BACKGROUND', 'Supporting harmony and pads.', '#6b8f71', true, array['BKG'], array['Pads', 'Chords']),
      (4, 'LEADS', 'Foreground melodic parts.', '#c49a1f', true, array['LDS'], array['Lead', 'Arpeggio']),
      (5, 'TEXTURE', 'Noise, atmosphere, degraded and granular material.', '#8a6fa8', true, array['TEX'], array['Atmosphere', 'Noise', 'Granular']),
      (6, 'VOX', 'Vocals and voice material.', '#c46a8a', true, array['VOX'], array['Vocal', 'Voice samples']),
      (7, 'STRUCTURE', 'Sections and transitions: work that belongs to no single part.', null, false, array[]::text[], array['Intro', 'Build', 'Drop', 'Breakdown', 'Transitions']),
      (8, 'BUS', 'Returns and the master chain.', null, false, array[]::text[], array['Parallel returns', 'Reverb and delay', 'Master chain'])
    ) v(pos, name, description, color, is_zone, prefixes, parts)
  loop
    insert into structure_elements (template_id, position, name, description, color, is_zone, prefixes)
    values (t, z.pos, z.name, z.description, z.color, z.is_zone, z.prefixes) returning id into e;
    i := 0;
    foreach part in array z.parts loop
      i := i + 1;
      insert into structure_elements (template_id, parent_id, position, name) values (t, e, i, part);
    end loop;
  end loop;
  update structure_templates set version = 1 where id = t;
end;
$seed$;

-- Copies a structure the person can read into their own account, keeping uids.
create or replace function structure_copy(p_source bigint, p_name text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  src structure_templates;
  new_id bigint;
begin
  if me is null or not app_active() or app_admin_viewing() then
    raise exception 'copying a structure needs an active account';
  end if;
  select * into src from structure_templates where id = p_source;
  if not found or (src.owner_id is not null and src.owner_id <> me) then
    raise exception 'that structure is not one you can copy';
  end if;
  insert into structure_templates (owner_id, name, copied_from) values (me, btrim(coalesce(p_name, '')), src.id) returning id into new_id;
  insert into structure_elements (template_id, uid, position, name, description, color, is_zone, prefixes, group_names)
  select new_id, uid, position, name, description, color, is_zone, prefixes, group_names
    from structure_elements where template_id = src.id and parent_id is null;
  insert into structure_elements (template_id, parent_id, uid, position, name, description, color)
  select new_id, np.id, c.uid, c.position, c.name, c.description, c.color
    from structure_elements c
    join structure_elements p on p.id = c.parent_id
    join structure_elements np on np.template_id = new_id and np.uid = p.uid
   where c.template_id = src.id;
  update structure_templates set version = 1 where id = new_id;
  return new_id;
end;
$body$;

alter table account_preferences add column if not exists structure_template_id bigint references structure_templates(id) on delete set null;
grant update (structure_template_id) on account_preferences to bottega_app;

create or replace function account_preferences_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if new.default_artist_id is not null
     and not exists (select 1 from artists where id = new.default_artist_id and account_id = new.user_id) then
    raise exception 'the default artist must be one of your own artists';
  end if;
  if new.music_template_id is not null
     and not exists (select 1 from workflow_templates where id = new.music_template_id and kind = 'music'
                      and (owner_id is null or owner_id = new.user_id)) then
    raise exception 'the template must be a music template of your own or the default';
  end if;
  if new.structure_template_id is not null
     and not exists (select 1 from structure_templates where id = new.structure_template_id
                      and (owner_id is null or owner_id = new.user_id)) then
    raise exception 'the structure must be one of your own or the default';
  end if;
  new.updated_at := now();
  return new;
end;
$body$;

create or replace function account_structure(p_account text) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce(
    (select structure_template_id from account_preferences where user_id = p_account),
    (select id from structure_templates where owner_id is null)
  )
$body$;

-- Each project's own tree ------------------------------------------------------------

alter table elements add column if not exists description text not null default '' check (char_length(description) <= 300);
alter table elements add column if not exists color text check (color ~ '^#[0-9a-f]{6}$');
alter table elements add column if not exists is_zone boolean not null default false;
alter table elements add column if not exists prefixes text[] not null default '{}' check (matchers_ok(prefixes));
alter table elements add column if not exists group_names text[] not null default '{}' check (matchers_ok(group_names));
alter table elements add column if not exists template_uid uuid;

create table if not exists project_structure (
  project_id        bigint primary key references projects(id) on delete cascade,
  template_id       bigint references structure_templates(id) on delete set null,
  template_version  int not null default 0
);

-- Copies the owner's structure into a project that has no elements yet;
-- returns how many elements it made.
create or replace function structure_start(p_project bigint) returns int
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  p projects;
  tpl structure_templates;
  n int;
begin
  if project_rank(p_project) < 3 or app_admin_viewing() then
    raise exception 'starting the structure needs edit access to the project';
  end if;
  if exists (select 1 from elements where project_id = p_project) then
    return 0;
  end if;
  select * into p from projects where id = p_project;
  select * into tpl from structure_templates where id = account_structure(p.owner_id);
  insert into elements (project_id, name, position, description, color, is_zone, prefixes, group_names, template_uid)
  select p_project, name, position, description, color, is_zone, prefixes, group_names, uid
    from structure_elements where template_id = tpl.id and parent_id is null;
  insert into elements (project_id, parent_id, name, position, description, color, template_uid)
  select p_project, pe.id, c.name, c.position, c.description, c.color, c.uid
    from structure_elements c
    join structure_elements tp on tp.id = c.parent_id
    join elements pe on pe.project_id = p_project and pe.template_uid = tp.uid
   where c.template_id = tpl.id;
  select count(*) into n from elements where project_id = p_project;
  insert into project_structure (project_id, template_id, template_version) values (p_project, tpl.id, tpl.version)
  on conflict (project_id) do update set template_id = excluded.template_id, template_version = excluded.template_version;
  return n;
end;
$body$;

-- workflow_start as in 024, now also copying the structure for music.
create or replace function workflow_start(p_project bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  cur text;
  p projects;
  tpl workflow_templates;
  first_stage text;
begin
  if project_rank(p_project) < 3 or app_admin_viewing() then
    raise exception 'starting the workflow needs edit access to the project';
  end if;
  select stage into cur from project_workflow where project_id = p_project;
  if found then
    return cur;
  end if;
  select * into p from projects where id = p_project;
  select * into tpl from workflow_templates where id = account_template(p.owner_id, p.kind);
  if tpl.id is null or not exists (select 1 from template_stages where template_id = tpl.id) then
    raise exception 'projects of kind % have no stages yet', p.kind;
  end if;
  delete from project_stages where project_id = p_project;
  insert into project_stages (project_id, key, position, label, standard)
  select p_project, key, row_number() over (order by position), label, standard from template_stages where template_id = tpl.id;
  select key into first_stage from project_stages where project_id = p_project order by position limit 1;
  insert into project_workflow (project_id, kind, stage, template_id, template_version)
  values (p_project, p.kind, first_stage, tpl.id, tpl.version);
  insert into exit_criteria (project_id, stage, body, hint, check_key, template_uid, position, created_by)
  select p_project, ts.key, tc.body, tc.hint, tc.check_key, tc.uid, tc.position, app_user()
    from template_stages ts join template_criteria tc on tc.stage_id = ts.id
   where ts.template_id = tpl.id;
  insert into stage_moves (project_id, from_stage, to_stage, moved_by) values (p_project, null, first_stage, app_user());
  if p.owner_id is not null then
    insert into board_places (user_id, project_id, place) values (p.owner_id, p_project, 'backlog')
    on conflict do nothing;
  end if;
  if p.kind = 'music' then
    perform structure_start(p_project);
  end if;
  return first_stage;
end;
$body$;

-- The zones a project's sets are read with, in order.
create or replace function project_zones(p_project bigint)
returns table (name text, color text, "position" int, prefixes text[], group_names text[])
language sql stable security definer set search_path = public, pg_temp as $body$
  select e.name, e.color, e.position, e.prefixes, e.group_names from elements e
   where e.project_id = p_project and e.parent_id is null and e.is_zone and project_rank(p_project) > 0
  union all
  select s.name, s.color, s.position, s.prefixes, s.group_names
    from projects p join structure_elements s on s.template_id = account_structure(p.owner_id)
   where p.id = p_project and s.parent_id is null and s.is_zone and project_rank(p_project) > 0
     and not exists (select 1 from elements x where x.project_id = p_project)
  order by 3, 1
$body$;

-- Offering template changes ---------------------------------------------------------

create or replace function structure_template_status(p_project bigint)
returns table (template_id bigint, name text, version int, seen_version int)
language sql stable security definer set search_path = public, pg_temp as $body$
  select t.id, t.name, t.version, ps.template_version
    from project_structure ps join structure_templates t on t.id = ps.template_id
   where ps.project_id = p_project and project_rank(p_project) > 0
$body$;

create or replace function structure_template_elements(p_project bigint)
returns table (uid uuid, parent_uid uuid, "position" int, name text, description text, color text, is_zone boolean, prefixes text[], group_names text[])
language sql stable security definer set search_path = public, pg_temp as $body$
  select e.uid, p.uid, e.position, e.name, e.description, e.color, e.is_zone, e.prefixes, e.group_names
    from project_structure ps
    join structure_elements e on e.template_id = ps.template_id
    left join structure_elements p on p.id = e.parent_id
   where ps.project_id = p_project and project_rank(p_project) > 0
   order by p.position nulls first, e.position
$body$;

-- Brings chosen template elements into a project: each uid given updates the
-- project's element with that uid (name, description, colour, zone and
-- matchers; its cards stay), or adds it (a part under its parent, when the
-- project has that parent). Marks the version seen; an empty list dismisses.
create or replace function structure_apply(p_project bigint, p_uids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  ps project_structure;
  v int;
  touched int := 0;
  n int;
begin
  if project_rank(p_project) < 3 or app_admin_viewing() then
    raise exception 'bringing in structure changes needs edit access to the project';
  end if;
  select * into ps from project_structure where project_id = p_project for update;
  if not found or ps.template_id is null then
    raise exception 'this project has no structure template to take changes from';
  end if;
  update elements e set name = s.name, description = s.description, color = s.color, is_zone = s.is_zone and e.parent_id is null,
                        prefixes = case when e.parent_id is null then s.prefixes else '{}' end,
                        group_names = case when e.parent_id is null then s.group_names else '{}' end
    from structure_elements s
   where s.template_id = ps.template_id and e.project_id = p_project and e.template_uid = s.uid
     and s.uid = any (coalesce(p_uids, '{}'))
     and (e.name, e.description, e.color, e.is_zone, e.prefixes, e.group_names)
         is distinct from (s.name, s.description, s.color, s.is_zone, s.prefixes, s.group_names);
  get diagnostics n = row_count;
  touched := touched + n;
  insert into elements (project_id, name, position, description, color, is_zone, prefixes, group_names, template_uid)
  select p_project, s.name, s.position, s.description, s.color, s.is_zone, s.prefixes, s.group_names, s.uid
    from structure_elements s
   where s.template_id = ps.template_id and s.parent_id is null and s.uid = any (coalesce(p_uids, '{}'))
     and not exists (select 1 from elements e where e.project_id = p_project and e.template_uid = s.uid);
  get diagnostics n = row_count;
  touched := touched + n;
  insert into elements (project_id, parent_id, name, position, description, color, template_uid)
  select p_project, pe.id, s.name, s.position, s.description, s.color, s.uid
    from structure_elements s
    join structure_elements tp on tp.id = s.parent_id
    join elements pe on pe.project_id = p_project and pe.template_uid = tp.uid
   where s.template_id = ps.template_id and s.uid = any (coalesce(p_uids, '{}'))
     and not exists (select 1 from elements e where e.project_id = p_project and e.template_uid = s.uid);
  get diagnostics n = row_count;
  touched := touched + n;
  select version into v from structure_templates where id = ps.template_id;
  update project_structure set template_version = v where project_id = p_project;
  return touched;
end;
$body$;

-- Projects that already have elements: matched to the default by name -----------------

do $backfill$
declare
  d bigint := (select id from structure_templates where owner_id is null);
  v int := (select version from structure_templates where owner_id is null);
begin
  update elements e set description = s.description, color = s.color, is_zone = s.is_zone, prefixes = s.prefixes,
                        group_names = s.group_names, template_uid = s.uid
    from structure_elements s
   where s.template_id = d and s.parent_id is null and e.parent_id is null
     and lower(e.name) = lower(s.name) and e.template_uid is null;
  update elements e set template_uid = s.uid, description = s.description
    from elements pe, structure_elements s, structure_elements sp
   where pe.id = e.parent_id and sp.id = s.parent_id and sp.template_id = d
     and pe.template_uid = sp.uid and lower(e.name) = lower(s.name) and e.template_uid is null;
  insert into project_structure (project_id, template_id, template_version)
  select distinct e.project_id, d, v from elements e
  on conflict (project_id) do nothing;
end;
$backfill$;

-- Row-level security ---------------------------------------------------------------------

alter table structure_templates enable row level security;
alter table structure_elements  enable row level security;
alter table project_structure   enable row level security;

drop policy if exists structure_templates_read on structure_templates;
create policy structure_templates_read on structure_templates for select
  using (app_active() and (owner_id is null or owner_id = app_user()));
drop policy if exists structure_templates_insert on structure_templates;
create policy structure_templates_insert on structure_templates for insert
  with check (app_active() and owner_id = app_user() and not app_admin_viewing());
drop policy if exists structure_templates_update on structure_templates;
create policy structure_templates_update on structure_templates for update
  using (app_active() and owner_id = app_user() and not app_admin_viewing()) with check (owner_id = app_user());
drop policy if exists structure_templates_delete on structure_templates;
create policy structure_templates_delete on structure_templates for delete
  using (app_active() and owner_id = app_user() and not app_admin_viewing());

drop policy if exists structure_elements_read on structure_elements;
create policy structure_elements_read on structure_elements for select
  using (app_active() and (structure_owner(template_id) is null or structure_owner(template_id) = app_user()));
drop policy if exists structure_elements_write on structure_elements;
create policy structure_elements_write on structure_elements for all
  using (app_active() and structure_owner(template_id) = app_user() and not app_admin_viewing())
  with check (structure_owner(template_id) = app_user());

drop policy if exists project_structure_read on project_structure;
create policy project_structure_read on project_structure for select using (project_rank(project_id) > 0);

-- Grants -----------------------------------------------------------------------------------

grant select on structure_templates, structure_elements, project_structure to bottega_app;
grant insert on structure_templates, structure_elements to bottega_app;
grant update (name) on structure_templates to bottega_app;
grant update (parent_id, position, name, description, color, is_zone, prefixes, group_names) on structure_elements to bottega_app;
grant delete on structure_templates, structure_elements to bottega_app;
grant update (description, color, is_zone, prefixes, group_names) on elements to bottega_app;
grant usage on all sequences in schema public to bottega_app;

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'structure_copy(bigint, text)', 'structure_start(bigint)', 'workflow_start(bigint)', 'project_zones(bigint)',
    'structure_template_status(bigint)', 'structure_template_elements(bigint)', 'structure_apply(bigint, uuid[])',
    'account_structure(text)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to bottega_app', f);
  end loop;
end;
$grants$;

commit;

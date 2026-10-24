-- 028 — Templates per artist, shared artists, learnings, and moving items
-- between notes, to-dos and learnings (REQUIREMENTS W-30 to W-37; decided
-- 24 October 2026; claude/PLAN-artists-learnings-todos.md).
--
--   - Artists gain a workflow template and a track structure. A project
--     starts with its artist's, else its owner's from Preferences
--     (project_template(), project_structure_template()). Starting a workflow
--     may name others (workflow_start_with()); workflow_start() and
--     structure_start() keep their one-argument forms for code deployed
--     before 028.
--   - Artists can be shared like projects (shares.artist_id), at view or
--     edit. Edit lets the grantee credit their own projects to the artist,
--     choose its templates, and edit the templates it uses. The artist stays
--     its owner's; projects credited while shared stay credited when the
--     share ends.
--   - Templates are read by their owner, everyone for the platform's, and
--     anyone who can see an artist that uses them; edited by their owner and
--     anyone with edit on such an artist. Renaming and deleting stay the
--     owner's. A template one can read can be copied.
--   - template_learnings: reminders on a template's stage, without a
--     checkbox, read live by every project using the template
--     (project_learnings()); they do not raise the template's version.
--     Claude proposes them (origin 'assistant', reviewed false).
--   - Moving: note_to_card(), card_to_note(), note_to_learning() and
--     card_to_learning() move an item, keeping its mix and moment between
--     notes and to-dos; the item exists in one place only.
--
-- Requires 027. Safe to run twice.

begin;

-- Shared artists ------------------------------------------------------------------------

alter table shares add column if not exists artist_id bigint references artists(id) on delete cascade;
alter table shares drop constraint if exists shares_one_item;
alter table shares add constraint shares_one_item check (num_nonnulls(project_id, gear_id, document_id, artist_id) = 1);
create unique index if not exists shares_artist_grantee on shares (artist_id, grantee_id) where artist_id is not null;

-- 4 the artist's account, 3 shared at edit, 1 shared at view, 0 nothing.
create or replace function artist_rank(p_artist bigint) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  owner text;
  best int := 0;
begin
  if me is null or not app_active() then
    return 0;
  end if;
  select account_id into owner from artists where id = p_artist;
  if not found then
    return 0;
  end if;
  if owner = me then
    return 4;
  end if;
  select coalesce(max(level_rank(level)), 0) into best from shares where artist_id = p_artist and grantee_id = me;
  if best < 1 and app_admin_viewing() then
    best := 1;
  end if;
  return best;
end;
$body$;

create or replace function share_item_rank(p_project_id bigint, p_gear_id bigint, p_document_id bigint, p_artist_id bigint) returns int
language sql stable as $body$
  select case when p_project_id is not null then project_rank(p_project_id)
              when p_gear_id is not null then gear_rank(p_gear_id)
              when p_document_id is not null then document_rank(p_document_id)
              when p_artist_id is not null then artist_rank(p_artist_id)
              else 0 end
$body$;

create or replace function shares_check_and_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  item_owner text;
  r shares;
  kind text;
  item bigint;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if r.project_id is not null then
    kind := 'project';
    item := r.project_id;
    select owner_id into item_owner from projects where id = r.project_id;
  elsif r.gear_id is not null then
    kind := 'gear';
    item := r.gear_id;
    select owner_id into item_owner from gear where id = r.gear_id;
  elsif r.document_id is not null then
    kind := 'document';
    item := r.document_id;
    select owner_id into item_owner from documents where id = r.document_id;
    if tg_op = 'INSERT' and item_owner is null then
      raise exception 'library documents are not shared; they are visible to everyone once approved';
    end if;
  else
    kind := 'artist';
    item := r.artist_id;
    select account_id into item_owner from artists where id = r.artist_id;
    if tg_op in ('INSERT', 'UPDATE') and new.level not in ('view', 'edit') then
      raise exception 'an artist is shared to view or to edit';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.grantee_id = item_owner then
      raise exception 'an owner cannot share an item with themselves';
    end if;
    if not exists (select 1 from accounts where user_id = new.grantee_id and status = 'active') then
      raise exception 'account % is not active', new.grantee_id;
    end if;
  end if;

  if tg_op = 'INSERT' then
    perform log_access('share_granted', new.grantee_id, kind, item, null, jsonb_build_object('level', new.level), null);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.level is distinct from new.level then
      perform log_access('share_changed', new.grantee_id, kind, item,
        jsonb_build_object('level', old.level), jsonb_build_object('level', new.level), null);
    end if;
    return new;
  else
    perform log_access('share_revoked', old.grantee_id, kind, item, jsonb_build_object('level', old.level), null, null);
    return old;
  end if;
end;
$body$;

drop policy if exists shares_read on shares;
create policy shares_read on shares for select
  using (app_active() and (grantee_id = app_user() or share_item_rank(project_id, gear_id, document_id, artist_id) = 4));
drop policy if exists shares_insert on shares;
create policy shares_insert on shares for insert
  with check (share_item_rank(project_id, gear_id, document_id, artist_id) = 4 and granted_by = app_user());
drop policy if exists shares_update on shares;
create policy shares_update on shares for update
  using (share_item_rank(project_id, gear_id, document_id, artist_id) = 4)
  with check (share_item_rank(project_id, gear_id, document_id, artist_id) = 4);
drop policy if exists shares_delete on shares;
create policy shares_delete on shares for delete
  using (share_item_rank(project_id, gear_id, document_id, artist_id) = 4);

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
      or (item_kind = 'artist' and artist_rank(item_id) = 4)
    ))
  );

-- An artist is seen by its account, those it is shared with, and anyone who
-- can see a project credited to it.
drop policy if exists artists_read on artists;
create policy artists_read on artists for select
  using (
    app_active() and (
      account_id = app_user()
      or artist_rank(id) > 0
      or exists (select 1 from music_projects m where m.artist_id = artists.id and project_rank(m.project_id) > 0)
      or exists (select 1 from collections c where c.artist_id = artists.id and project_rank(c.project_id) > 0)
    )
  );

-- A project is credited to an artist of its owner's account, or to one shared
-- with its owner at edit.
create or replace function credit_artist_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  proj_owner text;
  artist_owner text;
begin
  if new.artist_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.artist_id is not distinct from old.artist_id then
    return null;
  end if;
  select owner_id into proj_owner from projects where id = new.project_id;
  select account_id into artist_owner from artists where id = new.artist_id;
  if proj_owner is distinct from artist_owner
     and not exists (select 1 from shares s where s.artist_id = new.artist_id and s.grantee_id = proj_owner and s.level = 'edit') then
    raise exception 'artist % belongs to another account than project %', new.artist_id, new.project_id;
  end if;
  return null;
end;
$body$;

-- Templates per artist ------------------------------------------------------------------

alter table artists add column if not exists workflow_template_id bigint references workflow_templates(id) on delete set null;
alter table artists add column if not exists structure_template_id bigint references structure_templates(id) on delete set null;

-- Who reads and edits a template: its owner, anyone for the platform's
-- (reading only), and through the artists that use it.
create or replace function template_can_read(p_template bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select app_active() and exists (
    select 1 from workflow_templates t
     where t.id = p_template
       and (t.owner_id is null or t.owner_id = app_user()
            or exists (select 1 from artists a where a.workflow_template_id = t.id and artist_rank(a.id) > 0))
  )
$body$;

create or replace function template_can_edit(p_template bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select app_active() and not app_admin_viewing() and exists (
    select 1 from workflow_templates t
     where t.id = p_template and t.owner_id is not null
       and (t.owner_id = app_user()
            or exists (select 1 from artists a where a.workflow_template_id = t.id and artist_rank(a.id) >= 3))
  )
$body$;

create or replace function structure_can_read(p_template bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select app_active() and exists (
    select 1 from structure_templates t
     where t.id = p_template
       and (t.owner_id is null or t.owner_id = app_user()
            or exists (select 1 from artists a where a.structure_template_id = t.id and artist_rank(a.id) > 0))
  )
$body$;

create or replace function structure_can_edit(p_template bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select app_active() and not app_admin_viewing() and exists (
    select 1 from structure_templates t
     where t.id = p_template and t.owner_id is not null
       and (t.owner_id = app_user()
            or exists (select 1 from artists a where a.structure_template_id = t.id and artist_rank(a.id) >= 3))
  )
$body$;

drop policy if exists workflow_templates_read on workflow_templates;
create policy workflow_templates_read on workflow_templates for select using (template_can_read(id));
drop policy if exists template_stages_read on template_stages;
create policy template_stages_read on template_stages for select using (template_can_read(template_id));
drop policy if exists template_stages_write on template_stages;
create policy template_stages_write on template_stages for all
  using (template_can_edit(template_id)) with check (template_can_edit(template_id));
drop policy if exists template_criteria_read on template_criteria;
create policy template_criteria_read on template_criteria for select using (template_can_read(template_of_stage(stage_id)));
drop policy if exists template_criteria_write on template_criteria;
create policy template_criteria_write on template_criteria for all
  using (template_can_edit(template_of_stage(stage_id))) with check (template_can_edit(template_of_stage(stage_id)));

drop policy if exists structure_templates_read on structure_templates;
create policy structure_templates_read on structure_templates for select using (structure_can_read(id));
drop policy if exists structure_elements_read on structure_elements;
create policy structure_elements_read on structure_elements for select using (structure_can_read(template_id));
drop policy if exists structure_elements_write on structure_elements;
create policy structure_elements_write on structure_elements for all
  using (structure_can_edit(template_id)) with check (structure_can_edit(template_id));

-- Sets an artist's templates; null means the account's from Preferences.
-- Anyone with edit on the artist; each template must be one they can read.
create or replace function artist_set_templates(p_artist bigint, p_workflow bigint, p_structure bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if artist_rank(p_artist) < 3 or app_admin_viewing() then
    raise exception 'choosing an artist''s templates needs edit access to the artist';
  end if;
  if p_workflow is not null and not (template_can_read(p_workflow)
       and exists (select 1 from workflow_templates where id = p_workflow and kind = 'music')) then
    raise exception 'that workflow template is not one you can use';
  end if;
  if p_structure is not null and not structure_can_read(p_structure) then
    raise exception 'that track structure is not one you can use';
  end if;
  update artists set workflow_template_id = p_workflow, structure_template_id = p_structure where id = p_artist;
end;
$body$;

-- The templates a project starts with: its artist's, else its owner's.
create or replace function project_template(p_project bigint) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce(
    (select a.workflow_template_id
       from artists a
       join workflow_templates t on t.id = a.workflow_template_id and t.kind = p.kind
      where a.id = coalesce((select m.artist_id from music_projects m where m.project_id = p.id),
                            (select c.artist_id from collections c where c.project_id = p.id))),
    account_template(p.owner_id, p.kind))
  from projects p where p.id = p_project
$body$;

create or replace function project_structure_template(p_project bigint) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce(
    (select a.structure_template_id from music_projects m join artists a on a.id = m.artist_id where m.project_id = p.id),
    account_structure(p.owner_id))
  from projects p where p.id = p_project
$body$;

create or replace function project_stage_list(p_project bigint)
returns table (key text, "position" int, label text, standard text)
language sql stable security definer set search_path = public, pg_temp as $body$
  select ps.key, ps.position, ps.label, ps.standard from project_stages ps where ps.project_id = p_project
  union all
  select ts.key, ts.position, ts.label, ts.standard
    from template_stages ts
   where ts.template_id = project_template(p_project)
     and not exists (select 1 from project_stages x where x.project_id = p_project)
  order by 2
$body$;

-- Copies a structure into a project with no elements yet: the one named, or
-- the project's own (its artist's, else its owner's).
create or replace function structure_start_with(p_project bigint, p_structure bigint) returns int
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  tpl structure_templates;
  n int;
begin
  if project_rank(p_project) < 3 or app_admin_viewing() then
    raise exception 'starting the structure needs edit access to the project';
  end if;
  if exists (select 1 from elements where project_id = p_project) then
    return 0;
  end if;
  if p_structure is not null and not structure_can_read(p_structure) then
    raise exception 'that track structure is not one you can use';
  end if;
  select * into tpl from structure_templates where id = coalesce(p_structure, project_structure_template(p_project));
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

create or replace function structure_start(p_project bigint) returns int
language sql security definer set search_path = public, pg_temp as $body$
  select structure_start_with(p_project, null)
$body$;

-- Starts a project's workflow with the template named, or the project's own;
-- for music, the structure likewise.
create or replace function workflow_start_with(p_project bigint, p_template bigint, p_structure bigint) returns text
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
  if p_template is not null and not (template_can_read(p_template)
       and exists (select 1 from workflow_templates where id = p_template and kind = p.kind)) then
    raise exception 'that workflow template is not one you can use';
  end if;
  select * into tpl from workflow_templates where id = coalesce(p_template, project_template(p_project));
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
    perform structure_start_with(p_project, p_structure);
  end if;
  return first_stage;
end;
$body$;

create or replace function workflow_start(p_project bigint) returns text
language sql security definer set search_path = public, pg_temp as $body$
  select workflow_start_with(p_project, null, null)
$body$;

-- Learnings ------------------------------------------------------------------------------

create table if not exists template_learnings (
  id                 bigint generated always as identity primary key,
  stage_id           bigint not null references template_stages(id) on delete cascade,
  uid                uuid not null default gen_random_uuid(),
  position           int not null default 0,
  body               text not null check (btrim(body) <> '' and char_length(body) <= 2000),
  origin             text not null default 'human' check (origin in ('human', 'assistant')),
  reviewed           boolean not null default true,
  -- Where it came from, as a person reads it ("Khione · v4 at 3:30").
  source             text not null default '' check (char_length(source) <= 300),
  source_project_id  bigint references projects(id) on delete set null,
  created_by         text not null default app_user() references accounts(user_id),
  created_at         timestamptz not null default now(),
  check (origin = 'assistant' or reviewed)
);
create index if not exists template_learnings_stage_idx on template_learnings (stage_id, position);

alter table template_learnings enable row level security;
drop policy if exists template_learnings_read on template_learnings;
create policy template_learnings_read on template_learnings for select using (template_can_read(template_of_stage(stage_id)));
drop policy if exists template_learnings_insert on template_learnings;
create policy template_learnings_insert on template_learnings for insert
  with check (template_can_edit(template_of_stage(stage_id)) and created_by = app_user() and origin = 'human');
drop policy if exists template_learnings_update on template_learnings;
create policy template_learnings_update on template_learnings for update
  using (template_can_edit(template_of_stage(stage_id))) with check (template_can_edit(template_of_stage(stage_id)));
drop policy if exists template_learnings_delete on template_learnings;
create policy template_learnings_delete on template_learnings for delete using (template_can_edit(template_of_stage(stage_id)));

grant select, insert, delete on template_learnings to bottega_app;
grant update (position, body, reviewed) on template_learnings to bottega_app;

-- Copies take their learnings, keeping uids.
create or replace function template_copy(p_source bigint, p_name text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  src workflow_templates;
  new_id bigint;
  s record;
  new_stage bigint;
begin
  if me is null or not app_active() or app_admin_viewing() then
    raise exception 'copying a template needs an active account';
  end if;
  select * into src from workflow_templates where id = p_source;
  if not found or not template_can_read(p_source) then
    raise exception 'that template is not one you can copy';
  end if;
  insert into workflow_templates (owner_id, kind, name, copied_from)
  values (me, src.kind, btrim(coalesce(p_name, '')), src.id) returning id into new_id;
  for s in select * from template_stages where template_id = src.id order by position loop
    insert into template_stages (template_id, key, position, label, standard)
    values (new_id, s.key, s.position, s.label, s.standard) returning id into new_stage;
    insert into template_criteria (stage_id, uid, position, body, hint, check_key)
    select new_stage, uid, position, body, hint, check_key from template_criteria where stage_id = s.id;
    insert into template_learnings (stage_id, uid, position, body, source, source_project_id, created_by, created_at)
    select new_stage, uid, position, body, source, source_project_id, created_by, created_at
      from template_learnings where stage_id = s.id and reviewed;
  end loop;
  update workflow_templates set version = 1 where id = new_id;
  return new_id;
end;
$body$;

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
  if not found or not structure_can_read(p_source) then
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

-- The template stage a project's stage key names: in the template it started
-- from, else the one it would start from.
create or replace function project_template_stage(p_project bigint, p_stage text) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select ts.id from template_stages ts
   where ts.key = p_stage
     and ts.template_id = coalesce((select pw.template_id from project_workflow pw where pw.project_id = p_project),
                                   project_template(p_project))
$body$;

-- A project's learnings, by stage: those of the template it uses, for
-- anyone who can see the project. can_edit says whether the person may
-- change them.
create or replace function project_learnings(p_project bigint)
returns table (id bigint, stage text, "position" int, body text, origin text, reviewed boolean, source text,
               created_by text, created_by_name text, created_at timestamptz, can_edit boolean)
language sql stable security definer set search_path = public, pg_temp as $body$
  select l.id, ts.key, l.position, l.body, l.origin, l.reviewed, l.source, l.created_by, a.display_name, l.created_at,
         template_can_edit(ts.template_id)
    from template_stages ts
    join template_learnings l on l.stage_id = ts.id
    left join accounts a on a.user_id = l.created_by
   where project_rank(p_project) > 0
     and ts.template_id = coalesce((select pw.template_id from project_workflow pw where pw.project_id = p_project),
                                   project_template(p_project))
   order by ts.position, l.position, l.id
$body$;

-- Adds a learning to the stage of the project's template: as the person, or
-- as Claude's proposal. Returns its id.
create or replace function learning_add(p_project bigint, p_stage text, p_body text, p_source text, p_origin text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  st bigint := project_template_stage(p_project, p_stage);
  new_id bigint;
begin
  if project_rank(p_project) < 1 or st is null then
    raise exception 'that project has no such stage';
  end if;
  if not template_can_edit(template_of_stage(st)) then
    raise exception 'adding a learning needs edit access to the project''s template';
  end if;
  insert into template_learnings (stage_id, position, body, origin, reviewed, source, source_project_id, created_by)
  values (st, (select coalesce(max(position), 0) + 1 from template_learnings where stage_id = st), btrim(coalesce(p_body, '')),
          case when p_origin = 'assistant' then 'assistant' else 'human' end, p_origin is distinct from 'assistant',
          left(btrim(coalesce(p_source, '')), 300), p_project, app_user())
  returning id into new_id;
  return new_id;
end;
$body$;

-- Moving items ---------------------------------------------------------------------------

-- The stage a moved item lands in: the project's current, else its first.
create or replace function project_current_stage(p_project bigint) returns text
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce((select stage from project_workflow where project_id = p_project),
                  (select s.key from project_stage_list(p_project) s order by s.position limit 1))
$body$;

-- Who may move a note: its author with contribute or more, or anyone with edit.
create or replace function note_movable(n notes) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select not app_admin_viewing() and n.reviewed and n.rejected_at is null
     and (project_rank(n.project_id) >= 3 or (project_rank(n.project_id) = 2 and n.author_id = app_user()))
$body$;

create or replace function card_movable(c cards) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select not app_admin_viewing() and not c.settled and c.status not in ('proposed', 'rejected')
     and (project_rank(c.project_id) >= 3 or (project_rank(c.project_id) = 2 and c.created_by = app_user()))
$body$;

-- A note becomes a to-do in the project's current stage, keeping its author,
-- time, mix and moment. Returns the card's id.
create or replace function note_to_card(p_note bigint, p_element bigint, p_done_when text, p_kind text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  n notes;
  st text;
  new_id bigint;
begin
  select * into n from notes where id = p_note;
  if not found or not note_movable(n) then
    raise exception 'that note is not one you can move';
  end if;
  st := project_current_stage(n.project_id);
  if st is null then
    raise exception 'this kind of project has no stages yet';
  end if;
  if p_element is not null and not exists (select 1 from elements where id = p_element and project_id = n.project_id) then
    raise exception 'that element is not in this project';
  end if;
  insert into cards (project_id, element_id, stage, kind, what, done_when, status, audio_id, position_s, created_by, created_at)
  values (n.project_id, p_element, st, nullif(p_kind, ''), left(n.body, 1000),
          coalesce(nullif(btrim(coalesce(p_done_when, '')), ''), 'Not written yet'), 'accepted',
          n.audio_id, n.position_s, coalesce(n.author_id, app_user()), n.created_at)
  returning id into new_id;
  update cards set source_note_id = null where source_note_id = p_note;
  delete from notes where id = p_note;
  return new_id;
end;
$body$;

-- A to-do becomes a note: its element, stage and done-when are dropped, its
-- creator, time, mix and moment kept. Returns the note's id.
create or replace function card_to_note(p_card bigint) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  c cards;
  new_id bigint;
begin
  select * into c from cards where id = p_card;
  if not found or not card_movable(c) then
    raise exception 'that to-do is not one you can move';
  end if;
  insert into notes (project_id, audio_id, position_s, author, author_id, body, created_at)
  values (c.project_id, c.audio_id, case when c.audio_id is null then null else c.position_s end,
          coalesce((select display_name from accounts where user_id = c.created_by), ''), c.created_by, c.what, c.created_at)
  returning id into new_id;
  delete from cards where id = p_card;
  return new_id;
end;
$body$;

create or replace function note_to_learning(p_note bigint, p_stage text, p_body text, p_source text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  n notes;
  new_id bigint;
begin
  select * into n from notes where id = p_note;
  if not found or not note_movable(n) then
    raise exception 'that note is not one you can move';
  end if;
  new_id := learning_add(n.project_id, coalesce(p_stage, project_current_stage(n.project_id)),
                         coalesce(nullif(btrim(coalesce(p_body, '')), ''), n.body), p_source, 'human');
  update cards set source_note_id = null where source_note_id = p_note;
  delete from notes where id = p_note;
  return new_id;
end;
$body$;

create or replace function card_to_learning(p_card bigint, p_stage text, p_body text, p_source text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  c cards;
  new_id bigint;
begin
  select * into c from cards where id = p_card;
  if not found or not card_movable(c) then
    raise exception 'that to-do is not one you can move';
  end if;
  new_id := learning_add(c.project_id, coalesce(p_stage, c.stage),
                         coalesce(nullif(btrim(coalesce(p_body, '')), ''), c.what), p_source, 'human');
  delete from cards where id = p_card;
  return new_id;
end;
$body$;

-- Grants ----------------------------------------------------------------------------------

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'artist_rank(bigint)', 'template_can_read(bigint)', 'template_can_edit(bigint)', 'structure_can_read(bigint)',
    'structure_can_edit(bigint)', 'artist_set_templates(bigint, bigint, bigint)', 'project_template(bigint)',
    'project_structure_template(bigint)', 'structure_start_with(bigint, bigint)', 'structure_start(bigint)',
    'workflow_start_with(bigint, bigint, bigint)', 'workflow_start(bigint)', 'template_copy(bigint, text)',
    'structure_copy(bigint, text)', 'project_template_stage(bigint, text)', 'project_learnings(bigint)',
    'learning_add(bigint, text, text, text, text)', 'project_current_stage(bigint)', 'note_movable(notes)',
    'card_movable(cards)', 'note_to_card(bigint, bigint, text, text)', 'card_to_note(bigint)',
    'note_to_learning(bigint, text, text, text)', 'card_to_learning(bigint, text, text, text)', 'project_stage_list(bigint)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to bottega_app', f);
  end loop;
end;
$grants$;

commit;

-- 024 — Workflow templates, each project's own stages, the board, and the
-- re-entry note (REQUIREMENTS W-13 to W-24; decided 23 October 2026).
--
--   - workflow_templates, template_stages, template_criteria: the stages of a
--     kind of project and the exit criteria each starts with. A template with
--     no owner is the platform default; an account copies it (template_copy)
--     and edits its copy. Each criterion has a hint (plain text; lines
--     indented by two spaces render as a nested list) and may name a check
--     from workflow_checks, which marks it "likely done" from the newest saved
--     set. Criteria keep a uid across copies, so a project's criteria can be
--     compared with the template they came from. Every change to a template's
--     stages or criteria raises its version.
--   - account_preferences gains the template new music projects start from,
--     the most projects one keeps in rotation (default 4), and the days after
--     which an untouched project shows as cold (default 21).
--   - project_stages: each project's own copy of its stages, made when its
--     workflow starts. project_stage_list() gives a project's stages: its own
--     once started, before that the stages of its owner's template.
--     workflow_stages (011) is no longer read; it stays for history.
--   - workflow_start copies every stage's criteria at once, so later stages
--     show how far they have to go, and records the template and the version
--     it copied. template_apply() brings chosen template changes into a
--     project and marks the version seen.
--   - Music stages become Seed, Palette, Structure, Detail, Mixdown, Master,
--     Release. Existing projects, cards and criteria move: sketch to seed,
--     arrange to structure, mix to mixdown, master stays. A project already
--     started gets the default stages and no new criteria; its Workflow tab
--     offers the template's criteria to bring in.
--   - The re-entry note: project_workflow gains next_move and blocker
--     (workflow_set_next); work_log keeps each ended session (work_log_add).
--   - The board: board_places is each person's own board, a project in their
--     backlog or rotation. board_place() keeps rotation within the person's
--     limit; board_swap() exchanges two. A project is finished when it is in
--     its last stage and every accepted criterion of that stage is met
--     (project_workflow.finished_at, kept by workflow_check_finished()).
--
-- Requires 011. Safe to run twice.

begin;

-- Checks a criterion can name ---------------------------------------------------------

create table if not exists workflow_checks (
  key          text primary key check (key ~ '^[a-z_]+$'),
  label        text not null,
  description  text not null
);
insert into workflow_checks (key, label, description) values
  ('tempo_key', 'Tempo, key and scale set', 'The set has a tempo, and a key and scale chosen.'),
  ('has_reference', 'A reference track', 'The project has at least one reference.'),
  ('samples_collected', 'Samples collected', 'Every sample the set uses is inside the project folder.'),
  ('tracks_named', 'Tracks named and grouped', 'No track keeps a name Live gave it, and the tracks sit in groups.'),
  ('locators', 'Named locators', 'At least five locators, each with a name.'),
  ('dj_edges', 'Intro and outro to mix', 'The first and last sections are each at least 16 bars.'),
  ('no_gaps', 'Plays end to end', 'Clips cover the arrangement from start to end with no silent bar.'),
  ('automation', 'Automation written', 'At least three tracks carry automation.'),
  ('master_clean', 'Master left clean', 'No device is switched on in the main track.'),
  ('master_chain', 'Master chain set', 'A limiter or maximiser is switched on in the main track.')
on conflict (key) do update set label = excluded.label, description = excluded.description;

-- Templates ---------------------------------------------------------------------------

create table if not exists workflow_templates (
  id           bigint generated always as identity primary key,
  owner_id     text references accounts(user_id) on delete cascade,
  kind         text not null check (kind in ('music', 'installation', 'multimedia', 'collection')),
  name         text not null check (name = btrim(name) and name <> '' and char_length(name) <= 80),
  copied_from  bigint references workflow_templates(id) on delete set null,
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists workflow_templates_name_idx
  on workflow_templates (coalesce(owner_id, ''), kind, lower(name));
-- One platform default per kind.
create unique index if not exists workflow_templates_default_idx on workflow_templates (kind) where owner_id is null;

create table if not exists template_stages (
  id           bigint generated always as identity primary key,
  template_id  bigint not null references workflow_templates(id) on delete cascade,
  key          text not null check (key ~ '^[a-z]+$' and char_length(key) <= 40),
  position     int not null check (position > 0),
  label        text not null check (label = btrim(label) and label <> '' and char_length(label) <= 40),
  standard     text not null default '' check (char_length(standard) <= 200),
  unique (template_id, key),
  constraint template_stages_position_key unique (template_id, position) deferrable initially deferred
);

create table if not exists template_criteria (
  id         bigint generated always as identity primary key,
  stage_id   bigint not null references template_stages(id) on delete cascade,
  uid        uuid not null default gen_random_uuid(),
  position   int not null default 0,
  body       text not null check (btrim(body) <> '' and char_length(body) <= 500),
  hint       text not null default '' check (char_length(hint) <= 2000),
  check_key  text references workflow_checks(key)
);
create index if not exists template_criteria_stage_idx on template_criteria (stage_id, position);

-- The account whose template a row belongs to; null for the platform's.
create or replace function template_owner(p_template bigint) returns text
language sql stable security definer set search_path = public, pg_temp as $body$
  select owner_id from workflow_templates where id = p_template
$body$;

create or replace function template_of_stage(p_stage bigint) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select template_id from template_stages where id = p_stage
$body$;

-- Any change to a template's stages or criteria raises its version. A stage
-- key never changes: projects match their stages to the template by it.
create or replace function template_bump() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  t bigint;
begin
  if tg_table_name = 'template_stages' then
    if tg_op = 'UPDATE' and (new.key <> old.key or new.template_id <> old.template_id) then
      raise exception 'a stage''s key and template stay as they are';
    end if;
    t := coalesce(new.template_id, old.template_id);
  else
    if tg_op = 'UPDATE' and (new.stage_id <> old.stage_id or new.uid <> old.uid) then
      raise exception 'a template criterion stays with its stage';
    end if;
    t := template_of_stage(coalesce(new.stage_id, old.stage_id));
  end if;
  if t is not null then
    update workflow_templates set version = version + 1, updated_at = now() where id = t;
  end if;
  return null;
end;
$body$;
drop trigger if exists template_stages_bump on template_stages;
create trigger template_stages_bump after insert or update or delete on template_stages
  for each row execute function template_bump();
drop trigger if exists template_criteria_bump on template_criteria;
create trigger template_criteria_bump after insert or update or delete on template_criteria
  for each row execute function template_bump();

-- The platform defaults. Music from the Finish Line checklist (23 October),
-- collection as in 011. Seeded only when missing.
do $seed$
declare
  t bigint;
  s bigint;
  st record;
  c record;
begin
  if not exists (select 1 from workflow_templates where owner_id is null and kind = 'music') then
    insert into workflow_templates (kind, name) values ('music', 'Bottega default') returning id into t;
    for st in
      select * from (values
        (1, 'seed', 'Seed', 'A loop worth looping'),
        (2, 'palette', 'Palette', 'Sounds locked'),
        (3, 'structure', 'Structure', 'Plays start to finish'),
        (4, 'detail', 'Detail', 'The second drop earns its place'),
        (5, 'mixdown', 'Mixdown', 'Translates everywhere'),
        (6, 'master', 'Master', 'Ready for a system'),
        (7, 'release', 'Release', 'Out in the world')
      ) v(pos, k, label, standard)
    loop
      insert into template_stages (template_id, key, position, label, standard)
      values (t, st.k, st.pos, st.label, st.standard) returning id into s;
      for c in
        select * from (values
          ('seed', 1, 'An 8- to 16-bar loop with drums and the bass idea', 'The hook you would want to hear again tomorrow.', null),
          ('seed', 2, 'Tempo, key and scale set', E'Set the key and scale in Session View so Live\'s global scale follows.', 'tempo_key'),
          ('seed', 3, 'Reference track chosen', 'One released track you want this to sit next to in a set.', 'has_reference'),
          ('seed', 4, 'Saved under its dated working title, with Collect All and Save', 'YYYY-MM-DD and the working title. Collecting keeps the samples with the project when it moves.', 'samples_collected'),
          ('palette', 1, 'Kick and snare chosen and tuned to the key', '', null),
          ('palette', 2, 'Hats chosen and tuned', '', null),
          ('palette', 3, 'Sub layer designed', 'Clean, mono, sitting where the kick is not.', null),
          ('palette', 4, 'One or two atmosphere or texture layers', 'Pads, field recording, vinyl, dub chords.', null),
          ('palette', 5, 'Tracks named, grouped and coloured', 'By zone: TACTUS, BASS, BACKGROUND, LEADS, TEXTURE, VOX.', 'tracks_named'),
          ('structure', 1, 'Sections roughed in', 'Intro and build, drop 1, break, drop 2, outro, in 16-bar blocks.', null),
          ('structure', 2, 'A named locator at each section', '', 'locators'),
          ('structure', 3, 'An intro and outro a DJ can mix', '16 to 32 bars of drums to mix in and out of.', 'dj_edges'),
          ('structure', 4, 'Plays end to end with no dead spots', 'Even if the details are rough.', 'no_gaps'),
          ('detail', 1, 'Drop 2 differs from drop 1', 'A switch-up, half-time, or a new answer to the call.', null),
          ('detail', 2, 'Transitions built', 'Fills, risers, impacts, reverses, tape stops.', null),
          ('detail', 3, 'Automation pass', 'Filter moves, send throws, macro movement on the bass.', 'automation'),
          ('detail', 4, 'Other percussion chosen and tuned', '', null),
          ('detail', 5, 'Ear candy and vocals placed', 'Samples, sirens, one-shots.', null),
          ('detail', 6, 'A fresh-ears listen after a day away', 'Note the three things that bother you most.', null),
          ('mixdown', 1, 'Kick and sub relationship resolved', 'Sidechain or an EQ carve; no phase fights.', null),
          ('mixdown', 2, 'Low end mono below about 120 Hz', '', null),
          ('mixdown', 3, 'Gain staged, master left clean',
             E'VU meter, headroom at 14\nSpectrum analyser shows a general curve:\n  bass fundamental near 45 Hz at about -12 dB, rolling off below\n  low mids near -24 dB\n  mids near -36 dB\n  upper mids near -48 dB\n  tops near -60 dB',
             'master_clean'),
          ('mixdown', 4, 'Panning pass', 'Spread hats, percussion and synths across the stereo field. Haas widening for a sound you do not want panned.', null),
          ('mixdown', 5, 'Bounced and heard on small speakers, laptop, headphones and car', 'Can you still hear the bass line on a phone?', null),
          ('master', 1, 'Master chain set and loudness target hit', 'Decide the target before you start.', 'master_chain'),
          ('master', 2, 'True peak at or below -1 dBTP', '', null),
          ('master', 3, 'Master WAV exported, with an instrumental or stems', '24-bit, named with BPM and key.', null),
          ('master', 4, 'Heard on a big system', 'A club, a rehearsal room, or a friend''s rig.', null),
          ('release', 1, 'Collaborator sign-off', '', null),
          ('release', 2, 'Final title, artwork and metadata', 'BPM, key, ISRC, credits.', null),
          ('release', 3, 'Sent to label or distributor', '', null),
          ('release', 4, 'Promo copies sent to DJs', '', null)
        ) v(k, pos, body, hint, check_key)
        where v.k = st.k
      loop
        insert into template_criteria (stage_id, position, body, hint, check_key) values (s, c.pos, c.body, c.hint, c.check_key);
      end loop;
    end loop;
    update workflow_templates set version = 1 where id = t;
  end if;

  if not exists (select 1 from workflow_templates where owner_id is null and kind = 'collection') then
    insert into workflow_templates (kind, name) values ('collection', 'Bottega default') returning id into t;
    insert into template_stages (template_id, key, position, label) values
      (t, 'select', 1, 'Select'), (t, 'sequence', 2, 'Sequence'), (t, 'master', 3, 'Master'),
      (t, 'artwork', 4, 'Artwork'), (t, 'release', 5, 'Release');
    update workflow_templates set version = 1 where id = t;
  end if;
end;
$seed$;

-- Copies a template the person can read into their own account, criteria
-- keeping their uids. Returns the new template's id.
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
  if not found or (src.owner_id is not null and src.owner_id <> me) then
    raise exception 'that template is not one you can copy';
  end if;
  insert into workflow_templates (owner_id, kind, name, copied_from)
  values (me, src.kind, btrim(coalesce(p_name, '')), src.id) returning id into new_id;
  for s in select * from template_stages where template_id = src.id order by position loop
    insert into template_stages (template_id, key, position, label, standard)
    values (new_id, s.key, s.position, s.label, s.standard) returning id into new_stage;
    insert into template_criteria (stage_id, uid, position, body, hint, check_key)
    select new_stage, uid, position, body, hint, check_key from template_criteria where stage_id = s.id;
  end loop;
  update workflow_templates set version = 1 where id = new_id;
  return new_id;
end;
$body$;

-- Preferences ---------------------------------------------------------------------------

alter table account_preferences add column if not exists music_template_id bigint references workflow_templates(id) on delete set null;
alter table account_preferences add column if not exists rotation_limit int not null default 4;
alter table account_preferences add column if not exists cold_days int not null default 21;
alter table account_preferences drop constraint if exists account_preferences_rotation_limit_check;
alter table account_preferences add constraint account_preferences_rotation_limit_check check (rotation_limit between 1 and 20);
alter table account_preferences drop constraint if exists account_preferences_cold_days_check;
alter table account_preferences add constraint account_preferences_cold_days_check check (cold_days between 1 and 365);

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
  new.updated_at := now();
  return new;
end;
$body$;

grant update (default_artist_id, music_template_id, rotation_limit, cold_days) on account_preferences to bottega_app;

-- The template an account's new projects of a kind start from.
create or replace function account_template(p_account text, p_kind text) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce(
    (select ap.music_template_id from account_preferences ap where ap.user_id = p_account and p_kind = 'music'),
    (select id from workflow_templates where owner_id is null and kind = p_kind)
  )
$body$;

-- Each project's own stages -------------------------------------------------------------

create table if not exists project_stages (
  project_id  bigint not null references projects(id) on delete cascade,
  key         text not null check (key ~ '^[a-z]+$'),
  position    int not null check (position > 0),
  label       text not null check (label <> ''),
  standard    text not null default '',
  primary key (project_id, key),
  constraint project_stages_position_key unique (project_id, position) deferrable initially deferred
);

-- A project's stages: its own once its workflow has started, before that the
-- stages of its owner's template for its kind.
create or replace function project_stage_list(p_project bigint)
returns table (key text, "position" int, label text, standard text)
language sql stable security definer set search_path = public, pg_temp as $body$
  select ps.key, ps.position, ps.label, ps.standard from project_stages ps where ps.project_id = p_project
  union all
  select ts.key, ts.position, ts.label, ts.standard
    from projects p join template_stages ts on ts.template_id = account_template(p.owner_id, p.kind)
   where p.id = p_project and not exists (select 1 from project_stages x where x.project_id = p_project)
  order by 2
$body$;

create or replace function workflow_stage_ok(p_project bigint, p_stage text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select exists (select 1 from project_stage_list(p_project) s where s.key = p_stage)
$body$;

alter table project_workflow drop constraint if exists project_workflow_kind_stage_fkey;
alter table project_workflow add column if not exists template_id bigint references workflow_templates(id) on delete set null;
alter table project_workflow add column if not exists template_version int not null default 0;
alter table project_workflow add column if not exists next_move text not null default '' check (char_length(next_move) <= 1000);
alter table project_workflow add column if not exists blocker text not null default '' check (char_length(blocker) <= 500);
alter table project_workflow add column if not exists blocker_set_at timestamptz;
alter table project_workflow add column if not exists finished_at timestamptz;

alter table exit_criteria add column if not exists hint text not null default '' check (char_length(hint) <= 2000);
alter table exit_criteria add column if not exists check_key text references workflow_checks(key);
alter table exit_criteria add column if not exists template_uid uuid;
create index if not exists exit_criteria_uid_idx on exit_criteria (project_id, template_uid) where template_uid is not null;
grant update (hint, check_key) on exit_criteria to bottega_app;

-- Moving the music stages ---------------------------------------------------------------

-- Projects whose workflow started before this migration get the default
-- stages; their template version stays 0, so the template's criteria are
-- offered to them.
insert into project_stages (project_id, key, position, label, standard)
select pw.project_id, ts.key, row_number() over (partition by pw.project_id order by ts.position), ts.label, ts.standard
  from project_workflow pw
  join workflow_templates t on t.owner_id is null and t.kind = pw.kind
  join template_stages ts on ts.template_id = t.id
 where not exists (select 1 from project_stages x where x.project_id = pw.project_id);
update project_workflow pw set template_id = t.id
  from workflow_templates t where t.owner_id is null and t.kind = pw.kind and pw.template_id is null;

create temporary table stage_map (old text primary key, new text not null) on commit drop;
insert into stage_map values ('sketch', 'seed'), ('arrange', 'structure'), ('mix', 'mixdown');

alter table exit_criteria disable trigger exit_criteria_check;
alter table cards disable trigger cards_check;
update exit_criteria e set stage = m.new from stage_map m, projects p
 where e.stage = m.old and p.id = e.project_id and p.kind = 'music';
update cards c set stage = m.new from stage_map m, projects p
 where c.stage = m.old and p.id = c.project_id and p.kind = 'music';
alter table exit_criteria enable trigger exit_criteria_check;
alter table cards enable trigger cards_check;
update project_workflow pw set stage = m.new from stage_map m where pw.stage = m.old and pw.kind = 'music';
update stage_moves sm set to_stage = m.new from stage_map m, projects p
 where sm.to_stage = m.old and p.id = sm.project_id and p.kind = 'music';
update stage_moves sm set from_stage = m.new from stage_map m, projects p
 where sm.from_stage = m.old and p.id = sm.project_id and p.kind = 'music';

-- workflow_stages is no longer read; keep its music rows in step for anyone
-- looking at it.
delete from workflow_stages where kind = 'music';
insert into workflow_stages (kind, key, position, label)
select 'music', ts.key, ts.position, ts.label
  from workflow_templates t join template_stages ts on ts.template_id = t.id
 where t.owner_id is null and t.kind = 'music'
on conflict do nothing;

-- Finished --------------------------------------------------------------------------------

-- Finished: in the last stage, with at least one accepted criterion there and
-- every one of them met. Kept up to date after every change to criteria or
-- the stage.
create or replace function workflow_check_finished(p_project bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  cur text;
  last_key text;
  total int;
  open_count int;
  done boolean := false;
begin
  select stage into cur from project_workflow where project_id = p_project;
  if cur is null then
    return;
  end if;
  select key into last_key from project_stages where project_id = p_project order by position desc limit 1;
  if cur = last_key then
    select count(*), count(*) filter (where met_at is null) into total, open_count from exit_criteria
     where project_id = p_project and stage = cur and reviewed and rejected_at is null;
    done := total > 0 and open_count = 0;
  end if;
  update project_workflow
     set finished_at = case when done then coalesce(finished_at, now()) else null end
   where project_id = p_project
     and (finished_at is null) = done;
end;
$body$;

create or replace function exit_criteria_finished() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  perform workflow_check_finished(coalesce(new.project_id, old.project_id));
  return null;
end;
$body$;
drop trigger if exists exit_criteria_finished on exit_criteria;
create trigger exit_criteria_finished after insert or update or delete on exit_criteria
  for each row execute function exit_criteria_finished();

-- Moving through the stages, now over each project's own ------------------------------------

-- Starts a project's workflow: copies the stages and every stage's criteria
-- from the owner's template, records the template and its version, puts the
-- project on the owner's board in the backlog. Returns the first stage.
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
  -- Positions from 1 without gaps, whatever the template's.
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
  return first_stage;
end;
$body$;

-- Forward: the next stage only, once every accepted exit criterion of the
-- current one is met. Back: to any earlier stage, with a reason.
create or replace function workflow_move(p_project bigint, p_to text, p_reason text) returns text
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  cur project_workflow;
  cur_pos int;
  to_pos int;
  open_count int;
  why text := btrim(coalesce(p_reason, ''));
begin
  if project_rank(p_project) < 3 or app_admin_viewing() then
    raise exception 'moving the stage needs edit access to the project';
  end if;
  select * into cur from project_workflow where project_id = p_project for update;
  if not found then
    raise exception 'the workflow has not been started';
  end if;
  select position into cur_pos from project_stages where project_id = p_project and key = cur.stage;
  select position into to_pos from project_stages where project_id = p_project and key = p_to;
  if to_pos is null then
    raise exception 'stage % is not a stage of this project', p_to;
  end if;
  if to_pos = cur_pos then
    raise exception 'the project is already in %', p_to;
  elsif to_pos > cur_pos then
    if to_pos <> (select min(position) from project_stages where project_id = p_project and position > cur_pos) then
      raise exception 'stages advance one at a time';
    end if;
    select count(*) into open_count from exit_criteria
     where project_id = p_project and stage = cur.stage and reviewed and rejected_at is null and met_at is null;
    if open_count > 0 then
      raise exception '% exit criteria of % are not met', open_count, cur.stage;
    end if;
  elsif why = '' then
    raise exception 'moving back to an earlier stage needs a reason';
  end if;
  update project_workflow set stage = p_to, entered_at = now() where project_id = p_project;
  insert into stage_moves (project_id, from_stage, to_stage, reason, moved_by)
  values (p_project, cur.stage, p_to, why, app_user());
  perform workflow_check_finished(p_project);
  return p_to;
end;
$body$;

-- A note becomes a settled decision in the project's current stage, or its
-- first before the workflow starts.
create or replace function note_settle(p_note bigint, p_reason text, p_element bigint) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  n notes;
  st text;
  new_id bigint;
begin
  select * into n from notes where id = p_note;
  if not found or project_rank(n.project_id) < 3 or app_admin_viewing() then
    raise exception 'settling a decision needs edit access to the project';
  end if;
  select id into new_id from cards where source_note_id = p_note and settled limit 1;
  if new_id is not null then
    return new_id;
  end if;
  select stage into st from project_workflow where project_id = n.project_id;
  if st is null then
    select s.key into st from project_stage_list(n.project_id) s order by s.position limit 1;
  end if;
  if st is null then
    raise exception 'this kind of project has no stages yet';
  end if;
  insert into cards (project_id, element_id, stage, what, done_when, status, source_note_id, audio_id, position_s,
                     settled, settled_reason, settled_at, created_by)
  values (n.project_id, p_element, st, left(n.body, 1000), '', 'done', n.id, n.audio_id, n.position_s,
          true, btrim(coalesce(p_reason, '')), now(), app_user())
  returning id into new_id;
  return new_id;
end;
$body$;

-- The template a project came from, for its Workflow tab: whether it has
-- changed since. The template itself may be another account's, so this reads
-- as the owner. Anyone who can see the project may ask.
create or replace function workflow_template_status(p_project bigint)
returns table (template_id bigint, name text, version int, seen_version int)
language sql stable security definer set search_path = public, pg_temp as $body$
  select t.id, t.name, t.version, pw.template_version
    from project_workflow pw join workflow_templates t on t.id = pw.template_id
   where pw.project_id = p_project and project_rank(p_project) > 0
$body$;

-- The template's stages and criteria for a project, to compare with its own.
create or replace function workflow_template_criteria(p_project bigint)
returns table (stage text, stage_label text, standard text, uid uuid, "position" int, body text, hint text, check_key text)
language sql stable security definer set search_path = public, pg_temp as $body$
  select ts.key, ts.label, ts.standard, tc.uid, tc.position, tc.body, tc.hint, tc.check_key
    from project_workflow pw
    join template_stages ts on ts.template_id = pw.template_id
    left join template_criteria tc on tc.stage_id = ts.id
   where pw.project_id = p_project and project_rank(p_project) > 0
   order by ts.position, tc.position
$body$;

-- Brings chosen template criteria into a project: each uid given updates the
-- project's criterion with that uid (body, hint, check; whether it is met is
-- kept), or adds it to its stage when the project has that stage. Stage
-- labels and standards follow the template. Marks the template's version
-- seen, so an empty list dismisses the offer. Returns the criteria touched.
create or replace function template_apply(p_project bigint, p_uids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  pw project_workflow;
  v int;
  touched int := 0;
  n int;
begin
  if project_rank(p_project) < 3 or app_admin_viewing() then
    raise exception 'bringing in template changes needs edit access to the project';
  end if;
  select * into pw from project_workflow where project_id = p_project for update;
  if not found then
    raise exception 'the workflow has not been started';
  end if;
  if pw.template_id is null then
    raise exception 'this project''s template no longer exists';
  end if;
  update project_stages ps set label = ts.label, standard = ts.standard
    from template_stages ts
   where ts.template_id = pw.template_id and ps.project_id = p_project and ps.key = ts.key
     and (ps.label <> ts.label or ps.standard <> ts.standard);
  update exit_criteria e set body = tc.body, hint = tc.hint, check_key = tc.check_key
    from template_criteria tc join template_stages ts on ts.id = tc.stage_id
   where ts.template_id = pw.template_id and e.project_id = p_project and e.template_uid = tc.uid
     and tc.uid = any (coalesce(p_uids, '{}'))
     and (e.body, e.hint, e.check_key) is distinct from (tc.body, tc.hint, tc.check_key);
  get diagnostics n = row_count;
  touched := touched + n;
  insert into exit_criteria (project_id, stage, body, hint, check_key, template_uid, position, created_by)
  select p_project, ts.key, tc.body, tc.hint, tc.check_key, tc.uid,
         (select coalesce(max(x.position), 0) from exit_criteria x where x.project_id = p_project and x.stage = ts.key) + tc.position,
         app_user()
    from template_criteria tc join template_stages ts on ts.id = tc.stage_id
   where ts.template_id = pw.template_id and tc.uid = any (coalesce(p_uids, '{}'))
     and exists (select 1 from project_stages ps where ps.project_id = p_project and ps.key = ts.key)
     and not exists (select 1 from exit_criteria e where e.project_id = p_project and e.template_uid = tc.uid);
  get diagnostics n = row_count;
  touched := touched + n;
  select version into v from workflow_templates where id = pw.template_id;
  update project_workflow set template_version = v where project_id = p_project;
  return touched;
end;
$body$;

-- The re-entry note -------------------------------------------------------------------------

create table if not exists work_log (
  id          bigint generated always as identity primary key,
  project_id  bigint not null references projects(id) on delete cascade,
  did         text not null default '' check (char_length(did) <= 2000),
  next_move   text not null default '' check (char_length(next_move) <= 1000),
  logged_by   text not null references accounts(user_id),
  logged_at   timestamptz not null default now()
);
create index if not exists work_log_project_idx on work_log (project_id, logged_at desc);

-- Sets the next move, the blocker, or both; null leaves one as it is. A new
-- blocker starts its count of sessions.
create or replace function workflow_set_next(p_project bigint, p_next text, p_blocker text) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  nb text := btrim(coalesce(p_blocker, ''));
begin
  if project_rank(p_project) < 2 or app_admin_viewing() then
    raise exception 'setting the next move needs contribute access to the project';
  end if;
  if not exists (select 1 from project_workflow where project_id = p_project) then
    raise exception 'the workflow has not been started';
  end if;
  if p_next is not null then
    update project_workflow set next_move = btrim(p_next) where project_id = p_project;
  end if;
  if p_blocker is not null then
    update project_workflow
       set blocker = nb,
           blocker_set_at = case when nb = '' then null when nb = blocker then blocker_set_at else now() end
     where project_id = p_project;
  end if;
end;
$body$;

-- Ends a session: logs what was done and sets the next move. Returns the
-- entry's id.
create or replace function work_log_add(p_project bigint, p_did text, p_next text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  new_id bigint;
begin
  if project_rank(p_project) < 2 or app_admin_viewing() then
    raise exception 'ending a session needs contribute access to the project';
  end if;
  if not exists (select 1 from project_workflow where project_id = p_project) then
    raise exception 'the workflow has not been started';
  end if;
  if btrim(coalesce(p_did, '')) = '' and btrim(coalesce(p_next, '')) = '' then
    raise exception 'ending a session needs what was done or the next move';
  end if;
  insert into work_log (project_id, did, next_move, logged_by)
  values (p_project, btrim(coalesce(p_did, '')), btrim(coalesce(p_next, '')), app_user())
  returning id into new_id;
  update project_workflow set next_move = btrim(coalesce(p_next, '')) where project_id = p_project;
  return new_id;
end;
$body$;

-- The board ---------------------------------------------------------------------------------

create table if not exists board_places (
  user_id     text not null references accounts(user_id) on delete cascade,
  project_id  bigint not null references projects(id) on delete cascade,
  place       text not null check (place in ('backlog', 'rotation')),
  placed_at   timestamptz not null default now(),
  primary key (user_id, project_id)
);

-- Projects started before this migration go in their owner's backlog.
insert into board_places (user_id, project_id, place)
select p.owner_id, p.id, 'backlog' from project_workflow pw join projects p on p.id = pw.project_id
 where p.owner_id is not null
on conflict do nothing;

create or replace function rotation_limit(p_account text) returns int
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce((select rotation_limit from account_preferences where user_id = p_account), 4)
$body$;

-- Projects in the person's rotation that are not finished.
create or replace function rotation_count(p_account text, p_except bigint) returns int
language sql stable security definer set search_path = public, pg_temp as $body$
  select count(*)::int from board_places b left join project_workflow pw on pw.project_id = b.project_id
   where b.user_id = p_account and b.place = 'rotation' and pw.finished_at is null
     and b.project_id is distinct from p_except
$body$;

-- Puts a project the person can see on their board, in the backlog or in
-- rotation. Rotation is refused when it is full.
create or replace function board_place(p_project bigint, p_place text) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
begin
  if me is null or not app_active() or app_admin_viewing() or project_rank(p_project) < 1 then
    raise exception 'that project is not one you can put on your board';
  end if;
  if p_place not in ('backlog', 'rotation') then
    raise exception 'a project goes in the backlog or in rotation';
  end if;
  if p_place = 'rotation' and rotation_count(me, p_project) >= rotation_limit(me)
     and not exists (select 1 from project_workflow where project_id = p_project and finished_at is not null) then
    raise exception 'rotation is full: % of %', rotation_count(me, p_project), rotation_limit(me);
  end if;
  insert into board_places (user_id, project_id, place) values (me, p_project, p_place)
  on conflict (user_id, project_id) do update set place = excluded.place, placed_at = now()
  where board_places.place <> excluded.place;
end;
$body$;

-- Rotation is full: one project in, another back to the backlog.
create or replace function board_swap(p_in bigint, p_out bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
begin
  if me is null or not app_active() or app_admin_viewing() or project_rank(p_in) < 1 then
    raise exception 'that project is not one you can put on your board';
  end if;
  if not exists (select 1 from board_places where user_id = me and project_id = p_out and place = 'rotation') then
    raise exception 'the project to swap out is not in your rotation';
  end if;
  update board_places set place = 'backlog', placed_at = now() where user_id = me and project_id = p_out;
  perform board_place(p_in, 'rotation');
end;
$body$;

-- Row-level security ------------------------------------------------------------------------

alter table workflow_checks    enable row level security;
alter table workflow_templates enable row level security;
alter table template_stages    enable row level security;
alter table template_criteria  enable row level security;
alter table project_stages     enable row level security;
alter table work_log           enable row level security;
alter table board_places       enable row level security;

drop policy if exists workflow_checks_read on workflow_checks;
create policy workflow_checks_read on workflow_checks for select using (app_active());

-- The platform's templates are read by every active account; one's own only by oneself.
drop policy if exists workflow_templates_read on workflow_templates;
create policy workflow_templates_read on workflow_templates for select
  using (app_active() and (owner_id is null or owner_id = app_user()));
drop policy if exists workflow_templates_insert on workflow_templates;
create policy workflow_templates_insert on workflow_templates for insert
  with check (app_active() and owner_id = app_user() and not app_admin_viewing());
drop policy if exists workflow_templates_update on workflow_templates;
create policy workflow_templates_update on workflow_templates for update
  using (app_active() and owner_id = app_user() and not app_admin_viewing()) with check (owner_id = app_user());
drop policy if exists workflow_templates_delete on workflow_templates;
create policy workflow_templates_delete on workflow_templates for delete
  using (app_active() and owner_id = app_user() and not app_admin_viewing());

drop policy if exists template_stages_read on template_stages;
create policy template_stages_read on template_stages for select
  using (app_active() and (template_owner(template_id) is null or template_owner(template_id) = app_user()));
drop policy if exists template_stages_write on template_stages;
create policy template_stages_write on template_stages for all
  using (app_active() and template_owner(template_id) = app_user() and not app_admin_viewing())
  with check (template_owner(template_id) = app_user());

drop policy if exists template_criteria_read on template_criteria;
create policy template_criteria_read on template_criteria for select
  using (app_active() and (template_owner(template_of_stage(stage_id)) is null
                           or template_owner(template_of_stage(stage_id)) = app_user()));
drop policy if exists template_criteria_write on template_criteria;
create policy template_criteria_write on template_criteria for all
  using (app_active() and template_owner(template_of_stage(stage_id)) = app_user() and not app_admin_viewing())
  with check (template_owner(template_of_stage(stage_id)) = app_user());

drop policy if exists project_stages_read on project_stages;
create policy project_stages_read on project_stages for select using (project_rank(project_id) > 0);

drop policy if exists work_log_read on work_log;
create policy work_log_read on work_log for select using (project_rank(project_id) > 0);

drop policy if exists board_places_read on board_places;
create policy board_places_read on board_places for select using (user_id = app_user());
drop policy if exists board_places_delete on board_places;
create policy board_places_delete on board_places for delete using (user_id = app_user() and not app_admin_viewing());

-- Grants ------------------------------------------------------------------------------------

grant select on workflow_checks, workflow_templates, template_stages, template_criteria, project_stages, work_log, board_places
  to bottega_app;
grant insert on workflow_templates, template_stages, template_criteria to bottega_app;
grant update (name) on workflow_templates to bottega_app;
grant update (position, label, standard) on template_stages to bottega_app;
grant update (position, body, hint, check_key) on template_criteria to bottega_app;
grant delete on workflow_templates, template_stages, template_criteria, board_places to bottega_app;
grant usage on all sequences in schema public to bottega_app;

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'template_copy(bigint, text)', 'workflow_start(bigint)', 'workflow_move(bigint, text, text)',
    'note_settle(bigint, text, bigint)', 'workflow_template_status(bigint)', 'workflow_template_criteria(bigint)',
    'template_apply(bigint, uuid[])', 'workflow_set_next(bigint, text, text)', 'work_log_add(bigint, text, text)',
    'board_place(bigint, text)', 'board_swap(bigint, bigint)', 'project_stage_list(bigint)',
    'rotation_limit(text)', 'rotation_count(text, bigint)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to bottega_app', f);
  end loop;
end;
$grants$;

commit;

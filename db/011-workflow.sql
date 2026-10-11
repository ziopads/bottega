-- 011 — The workflow: stages, exit criteria, elements and cards
-- (REQUIREMENTS W-1 to W-10).
--
--   - workflow_stages: the stages of each kind of project, in order. Music:
--     sketch, arrange, mix, master (sound design is a kind of card, decided
--     11 October 2026). Collection: select, sequence, master, artwork,
--     release. Installation and multimedia have none yet.
--   - project_workflow: the stage a project is in (W-2), one row per project,
--     created when its workflow starts. stage_moves keeps every move, with
--     the reason a move back requires (W-4). Both are written only by
--     workflow_start() and workflow_move(), which enforce the rules: forward
--     one stage at a time, and only once every accepted exit criterion of the
--     current stage is met (W-3).
--   - exit_criteria: what finishes a stage, per project and stage (W-3).
--     Claude may propose them (origin 'assistant', reviewed false); a person
--     accepts or rejects each. Only accepted ones hold up a move.
--   - elements: the parts of the work as a tree (W-5), copied per project from
--     the template in lib/elementTemplate.ts and editable there.
--   - cards: open work on one element in one stage (W-6): what needs to
--     happen and how it will be known to be done. A card for a later stage is
--     parked until that stage begins (W-8). A card can come from a note, and
--     carry the mix and moment it was about. Settled decisions are cards with
--     settled true (W-9), set and cleared only by card_settle(),
--     note_settle() and card_reopen(); each reopening is kept with its reason.
--
-- Who may do what follows the project's level (AC-5): anyone who can see the
-- project reads its workflow; contribute adds cards and changes the cards one
-- wrote; edit moves the stage, writes criteria and elements, changes any
-- card, accepts or rejects proposals and settles decisions; only the owner
-- deletes (AC-7).
--
-- Requires 002 and 009. Safe to run twice.

begin;

-- Stages ------------------------------------------------------------------------------

create table if not exists workflow_stages (
  kind      text not null check (kind in ('music', 'installation', 'multimedia', 'collection')),
  key       text not null check (key ~ '^[a-z]+$'),
  position  int not null check (position > 0),
  label     text not null check (label <> ''),
  primary key (kind, key),
  unique (kind, position)
);

insert into workflow_stages (kind, key, position, label) values
  ('music', 'sketch', 1, 'Sketch'),
  ('music', 'arrange', 2, 'Arrange'),
  ('music', 'mix', 3, 'Mix'),
  ('music', 'master', 4, 'Master'),
  ('collection', 'select', 1, 'Select'),
  ('collection', 'sequence', 2, 'Sequence'),
  ('collection', 'master', 3, 'Master'),
  ('collection', 'artwork', 4, 'Artwork'),
  ('collection', 'release', 5, 'Release')
on conflict (kind, key) do nothing;

create table if not exists project_workflow (
  project_id  bigint primary key references projects(id) on delete cascade,
  kind        text not null,
  stage       text not null,
  entered_at  timestamptz not null default now(),
  foreign key (kind, stage) references workflow_stages(kind, key)
);

create table if not exists stage_moves (
  id          bigint generated always as identity primary key,
  project_id  bigint not null references projects(id) on delete cascade,
  from_stage  text,
  to_stage    text not null,
  reason      text not null default '',
  moved_by    text not null references accounts(user_id),
  moved_at    timestamptz not null default now()
);
create index if not exists stage_moves_project_idx on stage_moves (project_id, moved_at desc);

-- Exit criteria, elements, cards --------------------------------------------------------

create table if not exists exit_criteria (
  id           bigint generated always as identity primary key,
  project_id   bigint not null references projects(id) on delete cascade,
  stage        text not null,
  body         text not null check (btrim(body) <> '' and char_length(body) <= 500),
  position     int not null default 0,
  met_at       timestamptz,
  met_by       text references accounts(user_id),
  origin       text not null default 'human' check (origin in ('human', 'assistant')),
  reviewed     boolean not null default true,
  rejected_at  timestamptz,
  created_by   text not null default app_user() references accounts(user_id),
  created_at   timestamptz not null default now(),
  check (origin = 'assistant' or reviewed)
);
create index if not exists exit_criteria_project_idx on exit_criteria (project_id, stage, position);

create table if not exists elements (
  id          bigint generated always as identity primary key,
  project_id  bigint not null references projects(id) on delete cascade,
  parent_id   bigint references elements(id) on delete cascade,
  name        text not null check (name <> '' and name = btrim(name) and char_length(name) <= 80),
  position    int not null default 0
);
create index if not exists elements_project_idx on elements (project_id, parent_id, position);

create table if not exists cards (
  id              bigint generated always as identity primary key,
  project_id      bigint not null references projects(id) on delete cascade,
  element_id      bigint references elements(id) on delete set null,
  stage           text not null,
  kind            text check (kind is null or kind in ('sound design', 'writing', 'arrangement', 'mix', 'fix')),
  what            text not null check (btrim(what) <> '' and char_length(what) <= 1000),
  done_when       text not null default '' check (char_length(done_when) <= 1000),
  status          text not null default 'accepted'
                  check (status in ('proposed', 'accepted', 'in progress', 'done', 'rejected')),
  origin          text not null default 'human' check (origin in ('human', 'assistant')),
  source_note_id  bigint references notes(id) on delete set null,
  audio_id        bigint references audio(id) on delete set null,
  position_s      real check (position_s is null or (position_s >= 0 and position_s < 43200)),
  settled         boolean not null default false,
  settled_reason  text not null default '',
  settled_at      timestamptz,
  reopen_count    int not null default 0 check (reopen_count >= 0),
  created_by      text not null default app_user() references accounts(user_id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- W-6: how it will be known to be done, except for a settled decision.
  check (settled or btrim(done_when) <> ''),
  -- Only Claude proposes.
  check (origin = 'assistant' or status <> 'proposed')
);
create index if not exists cards_project_idx on cards (project_id, stage, element_id);

create table if not exists card_reopenings (
  id           bigint generated always as identity primary key,
  card_id      bigint not null references cards(id) on delete cascade,
  reason       text not null check (btrim(reason) <> ''),
  reopened_by  text not null references accounts(user_id),
  reopened_at  timestamptz not null default now()
);

-- Consistency checks. They read other rows, so they run as the owner.

create or replace function workflow_stage_ok(p_project bigint, p_stage text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select exists (
    select 1 from projects p join workflow_stages s on s.kind = p.kind and s.key = p_stage where p.id = p_project
  )
$body$;

create or replace function exit_criteria_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if not workflow_stage_ok(new.project_id, new.stage) then
    raise exception 'stage % is not a stage of this project''s kind', new.stage;
  end if;
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.stage <> old.stage then
      raise exception 'an exit criterion stays with its project and stage';
    end if;
    if new.met_at is not null and old.met_at is null then
      new.met_by := app_user();
    elsif new.met_at is null then
      new.met_by := null;
    end if;
  elsif new.met_at is not null then
    new.met_by := app_user();
  end if;
  return new;
end;
$body$;
drop trigger if exists exit_criteria_check on exit_criteria;
create trigger exit_criteria_check before insert or update on exit_criteria
  for each row execute function exit_criteria_check();

create or replace function elements_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'an element stays with its project';
  end if;
  if new.parent_id is not null
     and not exists (select 1 from elements where id = new.parent_id and project_id = new.project_id) then
    raise exception 'an element''s parent belongs to the same project';
  end if;
  if tg_op = 'UPDATE' and new.parent_id is not null then
    -- No cycles: the new parent must not sit under this element.
    if exists (
      with recursive up(id, parent_id) as (
        select id, parent_id from elements where id = new.parent_id
        union all
        select e.id, e.parent_id from elements e join up on e.id = up.parent_id
      )
      select 1 from up where id = new.id
    ) then
      raise exception 'an element cannot sit under itself';
    end if;
  end if;
  return new;
end;
$body$;
drop trigger if exists elements_check on elements;
create trigger elements_check before insert or update on elements
  for each row execute function elements_check();

create or replace function cards_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'a card stays with its project';
  end if;
  if not workflow_stage_ok(new.project_id, new.stage) then
    raise exception 'stage % is not a stage of this project''s kind', new.stage;
  end if;
  if new.element_id is not null
     and not exists (select 1 from elements where id = new.element_id and project_id = new.project_id) then
    raise exception 'a card''s element belongs to the same project';
  end if;
  if new.source_note_id is not null and (tg_op = 'INSERT' or new.source_note_id is distinct from old.source_note_id)
     and not exists (select 1 from notes where id = new.source_note_id and project_id = new.project_id) then
    raise exception 'a card''s note belongs to the same project';
  end if;
  if new.audio_id is not null and (tg_op = 'INSERT' or new.audio_id is distinct from old.audio_id)
     and not exists (select 1 from audio where id = new.audio_id and project_id = new.project_id) then
    raise exception 'a card''s mix belongs to the same project';
  end if;
  if new.position_s is not null and new.audio_id is null then
    new.position_s := null;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$body$;
drop trigger if exists cards_check on cards;
create trigger cards_check before insert or update on cards
  for each row execute function cards_check();

-- Moving through the stages --------------------------------------------------------------

-- Starts a project's workflow at its first stage; returns the stage it is in.
create or replace function workflow_start(p_project bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  cur text;
  k text;
  first_stage text;
begin
  if project_rank(p_project) < 3 or app_admin_viewing() then
    raise exception 'starting the workflow needs edit access to the project';
  end if;
  select stage into cur from project_workflow where project_id = p_project;
  if found then
    return cur;
  end if;
  select kind into k from projects where id = p_project;
  select key into first_stage from workflow_stages where kind = k order by position limit 1;
  if first_stage is null then
    raise exception 'projects of kind % have no stages yet', k;
  end if;
  insert into project_workflow (project_id, kind, stage) values (p_project, k, first_stage);
  insert into stage_moves (project_id, from_stage, to_stage, moved_by) values (p_project, null, first_stage, app_user());
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
  select position into cur_pos from workflow_stages where kind = cur.kind and key = cur.stage;
  select position into to_pos from workflow_stages where kind = cur.kind and key = p_to;
  if to_pos is null then
    raise exception 'stage % is not a stage of this project''s kind', p_to;
  end if;
  if to_pos = cur_pos then
    raise exception 'the project is already in %', p_to;
  elsif to_pos > cur_pos then
    if to_pos <> cur_pos + 1 then
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
  return p_to;
end;
$body$;

-- Settled decisions --------------------------------------------------------------------

create or replace function card_settle(p_card bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  proj bigint;
begin
  select project_id into proj from cards where id = p_card;
  if proj is null or project_rank(proj) < 3 or app_admin_viewing() then
    raise exception 'settling a decision needs edit access to the project';
  end if;
  update cards set settled = true, settled_reason = btrim(coalesce(p_reason, '')), settled_at = now(), updated_at = now()
   where id = p_card;
end;
$body$;

-- A note becomes a settled decision: a card carrying the note's text, its mix
-- and moment, in the project's current stage (or its first, before the
-- workflow starts). Returns the card's id.
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
  -- Settling the same note twice returns the decision already made.
  select id into new_id from cards where source_note_id = p_note and settled limit 1;
  if new_id is not null then
    return new_id;
  end if;
  select stage into st from project_workflow where project_id = n.project_id;
  if st is null then
    select s.key into st from projects p join workflow_stages s on s.kind = p.kind
     where p.id = n.project_id order by s.position limit 1;
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

-- Reopening a settled decision is an explicit act with a reason (W-9).
create or replace function card_reopen(p_card bigint, p_reason text) returns int
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  c cards;
  why text := btrim(coalesce(p_reason, ''));
begin
  select * into c from cards where id = p_card;
  if not found or project_rank(c.project_id) < 3 or app_admin_viewing() then
    raise exception 'reopening a decision needs edit access to the project';
  end if;
  if not c.settled then
    raise exception 'that card is not a settled decision';
  end if;
  if why = '' then
    raise exception 'reopening a settled decision needs a reason';
  end if;
  insert into card_reopenings (card_id, reason, reopened_by) values (p_card, why, app_user());
  update cards
     set settled = false, settled_at = null, reopen_count = reopen_count + 1,
         status = case when status = 'done' then 'accepted' else status end,
         done_when = case when btrim(done_when) = '' then 'Decided again' else done_when end,
         updated_at = now()
   where id = p_card;
  return c.reopen_count + 1;
end;
$body$;

-- Row-level security ----------------------------------------------------------------------

alter table workflow_stages   enable row level security;
alter table project_workflow  enable row level security;
alter table stage_moves       enable row level security;
alter table exit_criteria     enable row level security;
alter table elements          enable row level security;
alter table cards             enable row level security;
alter table card_reopenings   enable row level security;

drop policy if exists workflow_stages_read on workflow_stages;
create policy workflow_stages_read on workflow_stages for select using (app_active());

drop policy if exists project_workflow_read on project_workflow;
create policy project_workflow_read on project_workflow for select using (project_rank(project_id) > 0);

drop policy if exists stage_moves_read on stage_moves;
create policy stage_moves_read on stage_moves for select using (project_rank(project_id) > 0);

drop policy if exists exit_criteria_read on exit_criteria;
create policy exit_criteria_read on exit_criteria for select using (project_rank(project_id) > 0);
drop policy if exists exit_criteria_insert on exit_criteria;
create policy exit_criteria_insert on exit_criteria for insert
  with check (project_rank(project_id) >= 3 and created_by = app_user() and not app_admin_viewing());
drop policy if exists exit_criteria_update on exit_criteria;
create policy exit_criteria_update on exit_criteria for update
  using (project_rank(project_id) >= 3 and not app_admin_viewing())
  with check (project_rank(project_id) >= 3);
drop policy if exists exit_criteria_delete on exit_criteria;
create policy exit_criteria_delete on exit_criteria for delete using (project_rank(project_id) = 4);

drop policy if exists elements_read on elements;
create policy elements_read on elements for select using (project_rank(project_id) > 0);
drop policy if exists elements_insert on elements;
create policy elements_insert on elements for insert
  with check (project_rank(project_id) >= 3 and not app_admin_viewing());
drop policy if exists elements_update on elements;
create policy elements_update on elements for update
  using (project_rank(project_id) >= 3 and not app_admin_viewing())
  with check (project_rank(project_id) >= 3);
drop policy if exists elements_delete on elements;
create policy elements_delete on elements for delete using (project_rank(project_id) = 4);

drop policy if exists cards_read on cards;
create policy cards_read on cards for select using (project_rank(project_id) > 0);
drop policy if exists cards_insert on cards;
create policy cards_insert on cards for insert
  with check (project_rank(project_id) >= 2 and created_by = app_user() and not settled and not app_admin_viewing());
drop policy if exists cards_update on cards;
create policy cards_update on cards for update
  using ((project_rank(project_id) >= 3 or (project_rank(project_id) = 2 and created_by = app_user()))
         and not app_admin_viewing())
  with check (project_rank(project_id) >= 3 or (project_rank(project_id) = 2 and created_by = app_user()));
drop policy if exists cards_delete on cards;
create policy cards_delete on cards for delete using (project_rank(project_id) = 4);

drop policy if exists card_reopenings_read on card_reopenings;
create policy card_reopenings_read on card_reopenings for select
  using (exists (select 1 from cards c where c.id = card_id and project_rank(c.project_id) > 0));

-- Grants ------------------------------------------------------------------------------------

grant select on workflow_stages, project_workflow, stage_moves, exit_criteria, elements, cards, card_reopenings
  to bottega_app;
grant insert on exit_criteria, elements, cards to bottega_app;
grant update (body, position, met_at, reviewed, rejected_at) on exit_criteria to bottega_app;
grant update (name, parent_id, position) on elements to bottega_app;
grant update (element_id, stage, kind, what, done_when, status, audio_id, position_s) on cards to bottega_app;
grant delete on exit_criteria, elements, cards to bottega_app;
grant usage on all sequences in schema public to bottega_app;

revoke execute on function workflow_start(bigint) from public;
revoke execute on function workflow_move(bigint, text, text) from public;
revoke execute on function card_settle(bigint, text) from public;
revoke execute on function note_settle(bigint, text, bigint) from public;
revoke execute on function card_reopen(bigint, text) from public;
grant execute on function workflow_start(bigint) to bottega_app;
grant execute on function workflow_move(bigint, text, text) to bottega_app;
grant execute on function card_settle(bigint, text) to bottega_app;
grant execute on function note_settle(bigint, text, bigint) to bottega_app;
grant execute on function card_reopen(bigint, text) to bottega_app;

commit;

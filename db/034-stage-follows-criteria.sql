-- 034 — A project's stage follows what is done in it (issue #2, "Project stuck
-- in Palette stage"; REQUIREMENTS W-2 to W-4; docs/design-principles.md).
--
-- Until now the stage was a pointer that only workflow_move() changed, from the
-- Advance and Move back buttons, while criteria could be ticked in any stage
-- (and on the Board, which has no Advance button). Ticking everything left a
-- project on its old stage, and with it "pick up here", the Workflow tab, the
-- stage count and the to-do filters.
--
--   - workflow_sync_stage(): the current stage is the first stage, by
--     position, with an accepted exit criterion not yet met or an open to-do
--     (accepted or in progress, not settled); when there is none, the last
--     stage. Checking things off moves a project forward, past any stage
--     already complete; unticking a criterion, reopening a to-do, or adding
--     either to an earlier stage makes that stage current again. Claude's
--     proposals, rejected criteria, rejected to-dos and settled decisions do
--     not count, and neither do to-dos of stages not reached yet. A project
--     with no accepted criteria and no to-dos is left where it is. Each move
--     is written to stage_moves with its cause. When the stage changes, the
--     next to-do mark moves to the new stage.
--   - It runs once per statement that changes exit_criteria or cards (not per
--     row, so workflow_start's copy of every stage's criteria is seen whole),
--     before workflow_check_finished() reads the stage.
--   - workflow_check_finished(): a project is finished in its last stage with
--     every criterion met and no open to-do there.
--
-- FROM THIS POINT FORWARD. Nothing is recalculated here: no existing row is
-- touched. A project keeps its stored stage until its next change to a
-- criterion or to-do, when the stage is worked out afresh (so a project with
-- an open to-do in an earlier stage moves back to it then).
--
-- workflow_move() stays, unused by the app from here.
--
-- Requires 029. Safe to run twice.

begin;

create or replace function workflow_sync_stage(p_project bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  cur text;
  target text;
  cur_pos int;
  target_pos int;
  open_what text;
  why text;
  who text;
  cand bigint;
begin
  select stage into cur from project_workflow where project_id = p_project;
  if cur is null then
    return;
  end if;
  -- A project being deleted: its cards and criteria go before the project row
  -- is checked again, and nothing may be written for it.
  if not exists (select 1 from projects where id = p_project) then
    return;
  end if;

  -- Nothing to measure by: leave the project where it is.
  if not exists (
    select 1 from exit_criteria where project_id = p_project and reviewed and rejected_at is null
  ) and not exists (
    select 1 from cards where project_id = p_project and not settled and status in ('accepted', 'in progress', 'done')
  ) then
    return;
  end if;

  select ps.key into target
    from project_stages ps
   where ps.project_id = p_project
     and (
       exists (
         select 1 from exit_criteria c
          where c.project_id = p_project and c.stage = ps.key
            and c.reviewed and c.rejected_at is null and c.met_at is null
       )
       or exists (
         select 1 from cards k
          where k.project_id = p_project and k.stage = ps.key
            and not k.settled and k.status in ('accepted', 'in progress')
       )
     )
   order by ps.position
   limit 1;
  if target is null then
    select key into target from project_stages where project_id = p_project order by position desc limit 1;
  end if;
  if target is null or target = cur then
    return;
  end if;

  select position into cur_pos from project_stages where project_id = p_project and key = cur;
  select position into target_pos from project_stages where project_id = p_project and key = target;

  -- Whoever changed the criterion or to-do; failing that the owner, or whoever moved it last.
  who := coalesce(
    app_user(),
    (select owner_id from projects where id = p_project),
    (select moved_by from stage_moves where project_id = p_project order by moved_at desc, id desc limit 1)
  );
  if who is null then
    return;
  end if;

  if target_pos > coalesce(cur_pos, 0) then
    why := 'Stage complete';
  else
    select c.body into open_what from exit_criteria c
     where c.project_id = p_project and c.stage = target and c.reviewed and c.rejected_at is null and c.met_at is null
     order by c.position, c.id
     limit 1;
    if open_what is not null then
      why := 'Open criterion: ' || left(open_what, 200);
    else
      select k.what into open_what from cards k
       where k.project_id = p_project and k.stage = target and not k.settled and k.status in ('accepted', 'in progress')
       order by k.created_at, k.id
       limit 1;
      why := 'Open to-do: ' || left(coalesce(open_what, ''), 200);
    end if;
  end if;

  update project_workflow set stage = target, entered_at = now() where project_id = p_project;
  insert into stage_moves (project_id, from_stage, to_stage, reason, moved_by)
  values (p_project, cur, target, why, who);

  -- The next to-do belongs to the stage the project is in now: take the mark
  -- off a to-do of another stage, and give it to the stage's first open one.
  -- The two settings keep the card triggers from answering these updates.
  perform set_config('bottega.stage_sync', 'on', true);
  perform set_config('bottega.next_by_hand', 'on', true);
  update cards set is_next = false where project_id = p_project and is_next and stage <> target;
  if not exists (select 1 from cards where project_id = p_project and is_next) then
    cand := card_next_candidate(p_project, null);
    if cand is not null then
      update cards set is_next = true where id = cand;
    end if;
  end if;
  perform set_config('bottega.next_by_hand', 'off', true);
  perform set_config('bottega.stage_sync', 'off', true);
end;
$body$;

-- Finished: in the last stage, with at least one accepted criterion there,
-- every one of them met, and no open to-do. As in 024, with the to-dos added.
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
    done := total > 0 and open_count = 0 and not exists (
      select 1 from cards where project_id = p_project and stage = cur and not settled and status in ('accepted', 'in progress')
    );
  end if;
  update project_workflow
     set finished_at = case when done then coalesce(finished_at, now()) else null end
   where project_id = p_project
     and (finished_at is null) = done;
end;
$body$;

-- Once per statement, so a bulk insert (workflow_start) is judged as a whole.
-- Replaces the per-row exit_criteria_finished trigger of 024, which only kept
-- finished_at up to date. Not while workflow_sync_stage() moves the next mark.
create or replace function workflow_after_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  r record;
begin
  if current_setting('bottega.stage_sync', true) = 'on' then
    return null;
  end if;
  for r in select distinct project_id from changed loop
    perform workflow_sync_stage(r.project_id);
    perform workflow_check_finished(r.project_id);
  end loop;
  return null;
end;
$body$;

drop trigger if exists exit_criteria_finished on exit_criteria;
drop trigger if exists exit_criteria_after_insert on exit_criteria;
drop trigger if exists exit_criteria_after_update on exit_criteria;
drop trigger if exists exit_criteria_after_delete on exit_criteria;
drop trigger if exists cards_stage_after_insert on cards;
drop trigger if exists cards_stage_after_update on cards;
drop trigger if exists cards_stage_after_delete on cards;
drop function if exists exit_criteria_after();

create trigger exit_criteria_after_insert after insert on exit_criteria
  referencing new table as changed for each statement execute function workflow_after_change();
create trigger exit_criteria_after_update after update on exit_criteria
  referencing new table as changed for each statement execute function workflow_after_change();
create trigger exit_criteria_after_delete after delete on exit_criteria
  referencing old table as changed for each statement execute function workflow_after_change();
create trigger cards_stage_after_insert after insert on cards
  referencing new table as changed for each statement execute function workflow_after_change();
create trigger cards_stage_after_update after update on cards
  referencing new table as changed for each statement execute function workflow_after_change();
create trigger cards_stage_after_delete after delete on cards
  referencing old table as changed for each statement execute function workflow_after_change();

do $grants$
declare
  f text;
begin
  foreach f in array array['workflow_sync_stage(bigint)'] loop
    execute format('revoke execute on function %s from public', f);
  end loop;
end;
$grants$;

commit;

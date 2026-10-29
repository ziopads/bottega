-- 034 — A project's stage follows its exit criteria (issue #2, "Project stuck
-- in Palette stage"; REQUIREMENTS W-2 to W-4).
--
-- Until now the stage was a pointer that only workflow_move() changed, from the
-- Advance and Move back buttons, while criteria could be ticked in any stage
-- (and on the Board, which has no Advance button). Ticking everything left a
-- project on its old stage, and with it "pick up here", the Workflow tab, the
-- stage count and the to-do filters.
--
--   - workflow_sync_stage(): the current stage is the first stage, by
--     position, with an accepted exit criterion not yet met; when every one is
--     met, the last stage. Ticking moves a project forward, past any stage
--     already complete; unticking, or adding, a criterion in an earlier stage
--     makes that stage current again. A project with no accepted criteria is
--     left where it is. Each move is written to stage_moves with its cause.
--   - It runs once per statement that changes exit_criteria (not per row, so
--     workflow_start's copy of every stage's criteria is seen whole), before
--     workflow_check_finished() reads the stage.
--   - Every project's stage is brought into line now.
--
-- workflow_move() stays, unused by the app from here. To-dos (cards) do not
-- decide the stage.
--
-- Requires 024. Safe to run twice.

begin;

create or replace function workflow_sync_stage(p_project bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  cur text;
  target text;
  cur_pos int;
  target_pos int;
  open_body text;
  who text;
begin
  select stage into cur from project_workflow where project_id = p_project;
  if cur is null then
    return;
  end if;

  -- Nothing accepted to measure by: leave the project where it is.
  if not exists (
    select 1 from exit_criteria where project_id = p_project and reviewed and rejected_at is null
  ) then
    return;
  end if;

  select ps.key into target
    from project_stages ps
   where ps.project_id = p_project
     and exists (
       select 1 from exit_criteria c
        where c.project_id = p_project and c.stage = ps.key
          and c.reviewed and c.rejected_at is null and c.met_at is null
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

  -- Whoever changed the criterion; failing that the owner, or whoever moved it last.
  who := coalesce(
    app_user(),
    (select owner_id from projects where id = p_project),
    (select moved_by from stage_moves where project_id = p_project order by moved_at desc, id desc limit 1)
  );
  if who is null then
    return;
  end if;

  update project_workflow set stage = target, entered_at = now() where project_id = p_project;
  if target_pos > coalesce(cur_pos, 0) then
    insert into stage_moves (project_id, from_stage, to_stage, reason, moved_by)
    values (p_project, cur, target, 'Exit criteria met', who);
  else
    select c.body into open_body from exit_criteria c
     where c.project_id = p_project and c.stage = target and c.reviewed and c.rejected_at is null and c.met_at is null
     order by c.position, c.id
     limit 1;
    insert into stage_moves (project_id, from_stage, to_stage, reason, moved_by)
    values (p_project, cur, target, 'Open criterion: ' || left(coalesce(open_body, ''), 200), who);
  end if;
end;
$body$;

-- Once per statement, so a bulk insert (workflow_start) is judged as a whole.
-- Replaces the per-row exit_criteria_finished trigger of 024, which only kept
-- finished_at up to date.
create or replace function exit_criteria_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  r record;
begin
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
create trigger exit_criteria_after_insert after insert on exit_criteria
  referencing new table as changed for each statement execute function exit_criteria_after();
create trigger exit_criteria_after_update after update on exit_criteria
  referencing new table as changed for each statement execute function exit_criteria_after();
create trigger exit_criteria_after_delete after delete on exit_criteria
  referencing old table as changed for each statement execute function exit_criteria_after();

-- Projects already out of step. Run as the owner, so a move is credited to the
-- project's owner.
do $backfill$
declare
  r record;
begin
  for r in select project_id from project_workflow loop
    perform workflow_sync_stage(r.project_id);
    perform workflow_check_finished(r.project_id);
  end loop;
end;
$backfill$;

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

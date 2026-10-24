-- 029 — The next move is a to-do; the blocker and ending a session go
-- (REQUIREMENTS W-38 to W-41; decided 25 October 2026 from Gordon's use of his
-- own version: ending a session duplicated adding to-dos as one goes, and a
-- blocker is a to-do like any other).
--
--   - cards.is_next: at most one per project, the to-do to start with next
--     time. card_set_next() marks one (or none). When the next to-do is done,
--     rejected, settled, deleted or moved to a note, the next open to-do of the
--     project's current stage takes the mark: one in progress first, then the
--     oldest.
--   - Each project's next move and blocker (024) become to-dos in its current
--     stage, the next move marked next, and the two fields are emptied. The
--     columns, workflow_set_next() and work_log stay for code deployed before
--     029 and for the history already logged; sessions are read from saved
--     sets from now on (lib/sessions.ts).
--
-- Requires 028. Safe to run twice.

begin;

alter table cards add column if not exists is_next boolean not null default false;
create unique index if not exists cards_one_next on cards (project_id) where is_next;

-- The to-do that should take the mark next: in the project's current stage,
-- open, in progress before accepted, then oldest first.
create or replace function card_next_candidate(p_project bigint, p_except bigint) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select c.id from cards c
    join project_workflow pw on pw.project_id = c.project_id and pw.stage = c.stage
   where c.project_id = p_project and c.id is distinct from p_except and not c.settled
     and c.status in ('accepted', 'in progress')
   order by c.status = 'in progress' desc, c.created_at, c.id
   limit 1
$body$;

-- A finished or departed next to-do passes the mark on.
create or replace function cards_next_before() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if new.is_next and (new.settled or new.status not in ('accepted', 'in progress')) then
    new.is_next := false;
  end if;
  return new;
end;
$body$;
drop trigger if exists cards_next_before on cards;
create trigger cards_next_before before insert or update on cards for each row execute function cards_next_before();

create or replace function cards_next_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  pid bigint := coalesce(old.project_id, new.project_id);
  gone bigint := coalesce(old.id, new.id);
  cand bigint;
begin
  -- Only when the next mark has just left a to-do and none holds it now, and
  -- not while card_set_next() moves it by hand.
  if current_setting('bottega.next_by_hand', true) = 'on' then
    return null;
  end if;
  if not old.is_next or (tg_op = 'UPDATE' and new.is_next) or exists (select 1 from cards where project_id = pid and is_next) then
    return null;
  end if;
  cand := card_next_candidate(pid, gone);
  if cand is not null then
    update cards set is_next = true where id = cand;
  end if;
  return null;
end;
$body$;
drop trigger if exists cards_next_after on cards;
create trigger cards_next_after after update or delete on cards for each row execute function cards_next_after();

-- Marks a to-do as the project's next (one at a time), or clears the mark
-- when p_card is null. Its creator with contribute access, or anyone with edit.
create or replace function card_set_next(p_project bigint, p_card bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  c cards;
begin
  if project_rank(p_project) < 2 or app_admin_viewing() then
    raise exception 'choosing the next to-do needs contribute access to the project';
  end if;
  if p_card is not null then
    select * into c from cards where id = p_card and project_id = p_project;
    if not found or c.settled or c.status not in ('accepted', 'in progress') then
      raise exception 'only an open to-do of this project can be next';
    end if;
  end if;
  -- The after-trigger stays out of a move made by hand.
  perform set_config('bottega.next_by_hand', 'on', true);
  update cards set is_next = false where project_id = p_project and is_next and id is distinct from p_card;
  if p_card is not null then
    update cards set is_next = true where id = p_card and not is_next;
  end if;
  perform set_config('bottega.next_by_hand', 'off', true);
end;
$body$;

-- Existing next moves and blockers become to-dos. --------------------------------------
do $move$
declare
  r record;
  existing bigint;
begin
  perform set_config('bottega.next_by_hand', 'on', true);
  for r in
    select pw.project_id, pw.stage, btrim(pw.next_move) as next_move, btrim(pw.blocker) as blocker, p.owner_id
      from project_workflow pw join projects p on p.id = pw.project_id
     where (btrim(pw.next_move) <> '' or btrim(pw.blocker) <> '') and p.owner_id is not null
  loop
    if r.blocker <> '' then
      insert into cards (project_id, stage, what, done_when, status, created_by)
      values (r.project_id, r.stage, left(r.blocker, 1000), 'Not written yet', 'accepted', r.owner_id);
    end if;
    if r.next_move <> '' then
      select id into existing from cards
       where project_id = r.project_id and not settled and status in ('accepted', 'in progress') and btrim(what) = left(r.next_move, 1000)
       limit 1;
      if existing is null then
        insert into cards (project_id, stage, what, done_when, status, created_by)
        values (r.project_id, r.stage, left(r.next_move, 1000), 'Not written yet', 'accepted', r.owner_id)
        returning id into existing;
      end if;
      update cards set is_next = false where project_id = r.project_id and is_next and id <> existing;
      update cards set is_next = true where id = existing;
    end if;
    update project_workflow set next_move = '', blocker = '', blocker_set_at = null where project_id = r.project_id;
  end loop;
  perform set_config('bottega.next_by_hand', 'off', true);
end;
$move$;

do $grants$
declare
  f text;
begin
  foreach f in array array['card_next_candidate(bigint, bigint)', 'card_set_next(bigint, bigint)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to bottega_app', f);
  end loop;
end;
$grants$;

commit;

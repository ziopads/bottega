-- 032 — The method (decided 25 October 2026): the
-- principles of working a workflow template takes, a bold line and a
-- sentence or two each, for the whole template (learnings, 028, belong to a
-- stage). Read live from the project's template, shown at the foot of the
-- Workflow tab and the board, and given to Claude by the connector.
--
--   - template_principles, under the same rules as learnings: read with the
--     template, written by whoever can edit it (an artist shared at edit
--     included). Copies take them.
--   - The default music template starts with a draft method.
--
-- Requires 028. Safe to run twice.

begin;

create table if not exists template_principles (
  id           bigint generated always as identity primary key,
  template_id  bigint not null references workflow_templates(id) on delete cascade,
  uid          uuid not null default gen_random_uuid(),
  position     int not null default 0,
  title        text not null check (btrim(title) <> '' and char_length(title) <= 200),
  body         text not null default '' check (char_length(body) <= 1000),
  created_by   text references accounts(user_id) on delete set null default app_user(),
  created_at   timestamptz not null default now()
);
create index if not exists template_principles_template_idx on template_principles (template_id, position);

alter table template_principles enable row level security;
drop policy if exists template_principles_read on template_principles;
create policy template_principles_read on template_principles for select using (template_can_read(template_id));
drop policy if exists template_principles_insert on template_principles;
create policy template_principles_insert on template_principles for insert with check (template_can_edit(template_id));
drop policy if exists template_principles_update on template_principles;
create policy template_principles_update on template_principles for update
  using (template_can_edit(template_id)) with check (template_can_edit(template_id));
drop policy if exists template_principles_delete on template_principles;
create policy template_principles_delete on template_principles for delete using (template_can_edit(template_id));

grant select, insert, delete on template_principles to bottega_app;
grant update (position, title, body) on template_principles to bottega_app;

-- Copies take their method too (as 028, plus the principles).
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
  insert into template_principles (template_id, uid, position, title, body, created_by, created_at)
  select new_id, uid, position, title, body, created_by, created_at from template_principles where template_id = src.id;
  update workflow_templates set version = 1 where id = new_id;
  return new_id;
end;
$body$;

-- The default music template's method: a draft to change.
do $seed$
declare
  t bigint;
begin
  for t in select id from workflow_templates where owner_id is null and kind = 'music' loop
    if exists (select 1 from template_principles where template_id = t) then
      continue;
    end if;
    insert into template_principles (template_id, position, title, body, created_by) values
      (t, 1, 'A stage is finished when it is good enough to move on.',
       'Its exit criteria are met; perfection belongs to later stages. Polishing a loop in Seed is the usual way a track never leaves Seed.', null),
      (t, 2, 'A few in rotation, the rest in the backlog.',
       'Only the projects in rotation get your sessions. Everything else waits in the backlog with its stages, to-dos and notes intact; to bring one in when rotation is full, choose one to send back.', null),
      (t, 3, 'Always have a next to-do.',
       'One action you could start within five minutes of opening the set, written precisely: "resample the reese into a one-bar loop for the drop 2 answer", not "work on drop 2".', null),
      (t, 4, 'Capture to-dos as you go.',
       'Whatever comes to mind goes down as a to-do, tagged with the stage it belongs to. Only the current stage''s to-dos are on deck; the rest wait until the project gets there.', null),
      (t, 5, 'Stuck for two sessions? Change the approach.',
       'A to-do in progress across two sessions is stuck: bounce the part to audio, pull a reference, send it to a collaborator, or park it for a later stage.', null),
      (t, 6, 'Write down what you learn.',
       'A learning on a stage comes back on every project that reaches that stage.', null),
      (t, 7, 'Live reports, you decide.',
       'Bottega reads your saved sets and marks criteria as likely done. It never ticks one for you.', null),
      (t, 8, 'Cold projects get a decision.',
       'A project untouched for three weeks shows as cold. Give it a session, or send it back to the backlog on purpose.', null);
  end loop;
end;
$seed$;

commit;

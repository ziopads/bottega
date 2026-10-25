-- 032: a workflow template's method. Run on a database built to 32.
\set ON_ERROR_STOP 1
insert into accounts (user_id, email, display_name, status) values ('M1', 'm1@x', 'One', 'active'), ('M2', 'm2@x', 'Two', 'active')
  on conflict do nothing;
do $t$
declare
  def bigint;
  mine bigint;
  n int;
begin
  select id into def from workflow_templates where owner_id is null and kind = 'music' limit 1;
  select count(*) into n from template_principles where template_id = def;
  if n <> 8 then raise exception 'the default template should start with eight principles, got %', n; end if;
  raise notice 'ok: the default has a draft method';

  perform set_config('app.user_id', 'M1', true);
  set local role bottega_app;
  select count(*) into n from template_principles where template_id = def;
  if n <> 8 then raise exception 'anyone reads the default''s method, got %', n; end if;
  raise notice 'ok: the default''s method is readable';
  begin
    insert into template_principles (template_id, title) values (def, 'Mine');
    raise exception 'the default''s method should not take additions';
  exception when insufficient_privilege then raise notice 'ok: the default cannot be changed';
  end;
  mine := template_copy(def, 'M1 copy');
  select count(*) into n from template_principles where template_id = mine;
  if n <> 8 then raise exception 'a copy should take the method, got %', n; end if;
  raise notice 'ok: a copy takes the method';
  insert into template_principles (template_id, position, title, body) values (mine, 9, 'Bounce early.', 'Print the idea before it changes.');
  update template_principles set title = 'Four in rotation.' where template_id = mine and position = 2;
  delete from template_principles where template_id = mine and position = 6;
  select count(*) into n from template_principles where template_id = mine;
  if n <> 8 then raise exception 'one added and one removed should leave eight, got %', n; end if;
  raise notice 'ok: its owner edits the copy''s method';
  reset role;

  perform set_config('app.user_id', 'M2', true);
  set local role bottega_app;
  select count(*) into n from template_principles where template_id = mine;
  if n <> 0 then raise exception 'someone else should not read an unshared template''s method, got %', n; end if;
  raise notice 'ok: an unshared method stays private';
  reset role;
end;
$t$;

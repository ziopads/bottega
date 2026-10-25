-- 033: the Projects list's columns. Run on a database built to 33.
\set ON_ERROR_STOP 1
insert into accounts (user_id, email, display_name, status) values ('Q1', 'q1@x', 'One', 'active') on conflict do nothing;
do $t$
declare
  v text[];
begin
  perform set_config('app.user_id', 'Q1', true);
  set local role bottega_app;
  insert into account_preferences (project_columns) values (array['name', 'bpm', 'board'])
    on conflict (user_id) do update set project_columns = excluded.project_columns;
  select project_columns into v from account_preferences where user_id = 'Q1';
  if v <> array['name', 'bpm', 'board'] then raise exception 'the columns should be kept in order, got %', v; end if;
  raise notice 'ok: columns kept in order';
  begin
    update account_preferences set project_columns = array['name', 'secret'] where user_id = 'Q1';
    raise exception 'an unknown column should be refused';
  exception when check_violation then raise notice 'ok: an unknown column is refused';
  end;
  update account_preferences set project_columns = null where user_id = 'Q1';
  raise notice 'ok: back to the default';
  reset role;
end;
$t$;

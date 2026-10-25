-- 030: theme preferences and element colour slots. Run on a database built to 30.
\set ON_ERROR_STOP 1
do $t$
declare
  n int;
  v text;
  allowed text[] := array['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
begin
  -- From 031 the stored colours are Live's palette rather than these slots.
  if to_regprocedure('live_palette()') is not null then
    execute 'select live_palette()' into allowed;
  end if;
  -- Slots pass through; seeded colours go to their own slot; others to the nearest.
  if color_slot_hex('#2A78D6') <> '#2a78d6' then raise exception 'a slot should pass through, lower-cased'; end if;
  raise notice 'ok: a slot passes through';
  if color_slot_hex('#b5543c') <> '#e34948' or color_slot_hex('#3d5a80') <> '#2a78d6' or color_slot_hex('#6b8f71') <> '#008300'
     or color_slot_hex('#4f8a8b') <> '#1baf7a' or color_slot_hex('#a0522d') <> '#eb6834' then
    raise exception 'seeded colours should map to their own slots';
  end if;
  raise notice 'ok: seeded colours map by hand';
  select count(distinct color_slot_hex(c)) into n
    from unnest(array['#b5543c', '#3d5a80', '#6b8f71', '#c49a1f', '#8a6fa8', '#c46a8a', '#4f8a8b', '#a0522d']) c;
  if n <> 8 then raise exception 'the eight spare colours should take eight different slots, got %', n; end if;
  raise notice 'ok: the spare list covers all eight slots';
  if color_slot_hex('#1e6fd0') <> '#2a78d6' then raise exception 'a near blue should be the blue slot, got %', color_slot_hex('#1e6fd0'); end if;
  if color_slot_hex('#aa0000') <> '#e34948' then raise exception 'a dark red should be the red slot, got %', color_slot_hex('#aa0000'); end if;
  raise notice 'ok: other colours go to the nearest slot';
  if color_slot_hex(null) is not null then raise exception 'null stays null'; end if;
  raise notice 'ok: no colour stays none';

  -- Every stored colour is a slot after the migration.
  select count(*) into n from structure_elements
   where color is not null and color <> all(allowed);
  if n <> 0 then raise exception '% template colours are not slots', n; end if;
  raise notice 'ok: template colours are slots';

  -- The trigger moves a colour written later.
  update structure_elements set color = '#123456' where id = (select min(id) from structure_elements where color is not null);
  select color into v from structure_elements where id = (select min(id) from structure_elements where color is not null);
  if not (v = any(allowed)) then
    raise exception 'a colour written later should be moved to a slot, got %', v;
  end if;
  raise notice 'ok: the trigger moves a colour written later';

  -- Preferences: defaults and checks.
  select column_default into v from information_schema.columns where table_name = 'account_preferences' and column_name = 'theme';
  if v not like '%minimal%' then raise exception 'theme should default to minimal'; end if;
  select column_default into v from information_schema.columns where table_name = 'account_preferences' and column_name = 'mode';
  if v not like '%system%' then raise exception 'mode should default to system'; end if;
  raise notice 'ok: defaults are minimal and system';
  begin
    insert into accounts (user_id, email, status) values ('t030', 't030@example.com', 'active');
  exception when others then null;
  end;
  begin
    insert into account_preferences (user_id, theme) values ('t030', 'neon');
    raise exception 'an unknown theme should be refused';
  exception when check_violation then raise notice 'ok: an unknown theme is refused';
  end;
  begin
    insert into account_preferences (user_id, mode) values ('t030', 'dusk');
    raise exception 'an unknown mode should be refused';
  exception when check_violation then raise notice 'ok: an unknown mode is refused';
  end;
  select count(*) into n from information_schema.column_privileges
   where table_name = 'account_preferences' and grantee = 'bottega_app' and privilege_type = 'UPDATE' and column_name in ('theme', 'mode');
  if n <> 2 then raise exception 'the app should be able to update theme and mode'; end if;
  raise notice 'ok: the app may set theme and mode';
end;
$t$;

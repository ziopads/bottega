-- Tests for db/003-gear.sql: the model catalogue, unit ownership and sharing,
-- the owner-only insurance record, photos versus private files, capability
-- validation and the effective-capability view. Each check raises on failure.
--
-- Run against a scratch database with 001, 002 and 003 applied, never Neon:
--
--   psql -d bottega_test -f db/test/003-gear.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('C', 'c@x', 'Chris', 'active', false), ('G', 'g@x', 'Gordon', 'active', false)
on conflict (user_id) do nothing;
-- As the owner role (the administrator's pipeline), an approved model with capabilities.
insert into gear_models (kind, category, maker, model, status) values
  ('hardware', 'synthesizer', 'Sequential', 'Prophet-6', 'approved'),
  ('hardware', 'effect', 'Strymon', 'BigSky', 'approved');
insert into model_capabilities (model_id, capability, value)
  select id, 'polyphony', '6' from gear_models where model = 'Prophet-6';
insert into model_capabilities (model_id, capability, value)
  select id, 'microtuning', 'false' from gear_models where model = 'Prophet-6';
select set_config('app.actor', '', false);

create schema if not exists tst; grant usage on schema tst to bottega_app;
create or replace function tst.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.model(m text) returns bigint language sql as $$ select id from gear_models where model = m $$;

set role bottega_app;

-- Capability values are checked against the vocabulary -------------------------------
reset role;
do $$ begin
  insert into model_capabilities (model_id, capability, value) values (tst.model('Prophet-6'), 'polyphony', '"six"');
  raise exception 'FAILED: text accepted as an integer';
exception when raise_exception then raise notice 'ok: polyphony must be an integer';
end $$;
do $$ begin
  insert into model_capabilities (model_id, capability, value) values (tst.model('Prophet-6'), 'tuning_methods', '["telepathy"]');
  raise exception 'FAILED: list value outside its choices';
exception when raise_exception then raise notice 'ok: list values must be among the choices';
end $$;
set role bottega_app;

-- James adds his Prophet-6; Chris suggests a model -----------------------------------
select set_config('app.user_id', 'J', false);
insert into gear (model_id, nickname) values (tst.model('Prophet-6'), 'P6');
update gear_private set serial = 'P6-0042', purchase_price = 2999, location = 'studio' where gear_id = (select id from gear where nickname = 'P6');
-- His unit holds alternate tuning after a firmware update, unlike the model.
insert into gear_capabilities (gear_id, capability, value) values ((select id from gear where nickname = 'P6'), 'microtuning', 'true');
select tst.expect(
  (select value from gear_capabilities_effective e join gear g on g.id = e.gear_id where g.nickname = 'P6' and capability = 'microtuning') = 'true',
  'unit override wins over the model');
select tst.expect(
  (select value from gear_capabilities_effective e join gear g on g.id = e.gear_id where g.nickname = 'P6' and capability = 'polyphony') = '6',
  'model capability shows through where not overridden');
-- The question the catalogue has to answer.
select tst.expect(
  (select array_agg(g.nickname) from gear g join gear_models m on m.id = g.model_id
     join gear_capabilities_effective e on e.gear_id = g.id
    where g.status = 'owned' and is_sound_source(m.category) and e.capability = 'microtuning' and e.value = 'true') = array['P6'],
  'which of my sound sources can hold a non-equal-tempered scale');

select set_config('app.user_id', 'C', false);
insert into gear_models (kind, category, maker, model, status) values ('hardware', 'sampler', 'Akai', 'MPC Live II', 'approved');
select tst.expect((select status from gear_models where model = 'MPC Live II') = 'suggested', 'a non-admin suggestion arrives as suggested');
select tst.expect((select count(*) from gear) = 0, 'Chris sees none of James''s gear');
select tst.expect((select count(*) from gear_private) = 0, 'Chris sees no insurance records');
update gear_models set status = 'approved' where model = 'MPC Live II';
reset role;
select tst.expect((select status from gear_models where model = 'MPC Live II') = 'suggested', 'a non-admin cannot approve a model');
set role bottega_app;
do $$ begin
  insert into model_capabilities (model_id, capability, value) values (tst.model('BigSky'), 'audio_inputs', '2');
  raise exception 'FAILED: non-admin wrote a model capability';
exception when insufficient_privilege then raise notice 'ok: only the administrator writes model capabilities';
end $$;

select set_config('app.user_id', 'G', false);
select tst.expect(not exists (select 1 from gear_models where model = 'MPC Live II'), 'Gordon does not see Chris''s pending suggestion');
select tst.expect(exists (select 1 from gear_models where model = 'Prophet-6'), 'approved models are visible to all');

-- James approves the suggestion ------------------------------------------------------
select set_config('app.user_id', 'J', false);
update gear_models set status = 'approved' where model = 'MPC Live II';
select tst.expect((select status from gear_models where model = 'MPC Live II') = 'approved', 'the administrator approves a model');

-- Sharing a unit shows the unit and photos, never the insurance record -------------
insert into gear_files (gear_id, role, r2_key, filename) values
  ((select id from gear where nickname = 'P6'), 'photo', 'g/1', 'front.jpg'),
  ((select id from gear where nickname = 'P6'), 'receipt', 'g/2', 'receipt.pdf');
insert into shares (gear_id, grantee_id, level) values ((select id from gear where nickname = 'P6'), 'C', 'view');

select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) from gear where nickname = 'P6') = 1, 'Chris sees the shared unit');
select tst.expect((select count(*) from gear_private) = 0, 'but not its serial, price or location');
select tst.expect((select array_agg(role) from gear_files) = array['photo'], 'and its photos, not its receipt');
select tst.expect(gear_level((select id from gear where nickname = 'P6')) = 'view', 'at view');
update gear set nickname = 'mine now' where nickname = 'P6';
delete from gear where nickname = 'P6';
do $$ begin
  insert into gear_files (gear_id, role, r2_key, filename) values ((select id from gear where nickname = 'P6'), 'photo', 'g/3', 'x.jpg');
  raise exception 'FAILED: viewer added a photo';
exception when insufficient_privilege then raise notice 'ok: a viewer cannot add photos';
end $$;
reset role;
select tst.expect((select count(*) from gear where nickname = 'P6') = 1, 'viewer changed and deleted nothing');
set role bottega_app;

-- Contribute adds photos, not receipts ----------------------------------------------
select set_config('app.user_id', 'J', false);
update shares set level = 'contribute' where grantee_id = 'C';
select set_config('app.user_id', 'C', false);
insert into gear_files (gear_id, role, r2_key, filename) values ((select id from gear where nickname = 'P6'), 'photo', 'g/4', 'side.jpg');
do $$ begin
  insert into gear_files (gear_id, role, r2_key, filename) values ((select id from gear where nickname = 'P6'), 'receipt', 'g/5', 'r.pdf');
  raise exception 'FAILED: contributor added a receipt';
exception when insufficient_privilege then raise notice 'ok: contributors add photos only';
end $$;

-- The administrator's read-only view never reaches the insurance record -----------------
select set_config('app.user_id', 'J', false);
reset role;
insert into gear (owner_id, name, maker) values ('G', 'Juno-106', 'Roland');
set role bottega_app;
select set_config('app.admin_view', 'on', false);
select tst.expect((select count(*) from gear where name = 'Juno-106') = 1, 'admin view sees Gordon''s unit');
select tst.expect(not exists (select 1 from gear_private p join gear g on g.id = p.gear_id where g.name = 'Juno-106'),
  'admin view never sees Gordon''s insurance record');
select set_config('app.admin_view', '', false);

-- Gear shares log themselves -----------------------------------------------------------
reset role;
select tst.expect((select count(*) from access_log where item_kind = 'gear' and action in ('share_granted', 'share_changed')) = 2,
  'gear shares are in the access log');

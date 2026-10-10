-- 003: Gear. REQUIREMENTS §4 (G-1 to G-7), ARCHITECTURE §4 "Gear" and §11.
--
-- Two levels, decided 10 October 2026:
--
--   gear_models   the platform's catalogue of makes and models (a Sequential
--                 Prophet-6, Ableton Live 12), with their capabilities and,
--                 from 004, the library manuals that describe them. One entry
--                 per model for every account. Anyone suggests a model; the
--                 platform administrator approves it and keeps its facts.
--
--   gear          one account's physical unit or licence: which model it is,
--                 its nickname, firmware, photos, and whether it is owned,
--                 wished for or gone. Owned by an account like a project,
--                 shareable like a project.
--
--   gear_private  the same unit's insurance record: serial, purchase date and
--                 price, seller, condition, location, service history, licence
--                 key and seats. One row per unit, readable and writable by
--                 the owner only, whatever the unit is shared at. Kept as its
--                 own table because row-level security works on rows: a shared
--                 unit's row is visible to the grantee, so private columns
--                 have to live in a row they cannot see.
--
-- Capabilities are typed facts drawn from a platform vocabulary
-- (capability_defs), set on the model (model_capabilities) and overridden per
-- unit where a unit differs (gear_capabilities: a modded voice card, newer
-- firmware). gear_capabilities_effective gives each visible unit's answer,
-- which is what "which of my sound sources can hold a non-equal-tempered
-- scale?" queries.
--
-- Requires 002. Safe to run twice.

begin;

-- 002's app_admin_viewing() returned null rather than false on a connection
-- where app.admin_view had never been set, and "not null" fails a policy
-- check. The app always sets it, so nothing was refused in practice; scripts
-- and tests that do not would have been. It answers false now.
create or replace function app_admin_viewing() returns boolean
language sql stable as $body$
  select coalesce(current_setting('app.admin_view', true), '') = 'on' and app_is_admin()
$body$;

-- Capability vocabulary (platform-wide) -------------------------------------------

create table if not exists capability_defs (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  label        text not null check (label <> ''),
  value_type   text not null check (value_type in ('boolean', 'integer', 'number', 'text', 'enum', 'list')),
  unit         text not null default '',
  choices      text[] not null default '{}',
  description  text not null default '',
  position     int not null default 100,
  check ((value_type in ('enum', 'list')) = (cardinality(choices) > 0))
);

-- The first vocabulary. Any active account may add a capability (REQUIREMENTS
-- §15, decision 7); these are the ones the questions so far need.
insert into capability_defs (key, label, value_type, unit, choices, description, position) values
  ('polyphony',        'Polyphony',            'integer', 'voices', '{}', 'Simultaneous voices; 1 for monophonic.', 10),
  ('multitimbral',     'Multitimbral parts',   'integer', 'parts',  '{}', 'Independent sounds playable at once.', 20),
  ('synthesis',        'Synthesis',            'list',    '',
     '{analog subtractive,virtual analog,fm,wavetable,additive,granular,physical modelling,sample playback,vector,phase distortion,other}',
     'Methods of sound generation.', 30),
  ('microtuning',      'Microtuning',          'boolean', '',       '{}', 'Can hold scales other than twelve-tone equal temperament.', 40),
  ('tuning_methods',   'Tuning methods',       'list',    '',
     '{scala files,mts-esp,midi tuning standard,per-note tuning table,octave tuning table,just intonation presets,pitch bend per voice}',
     'How alternate tunings are loaded or played.', 50),
  ('mpe',              'MPE',                  'boolean', '',       '{}', 'MIDI Polyphonic Expression.', 60),
  ('aftertouch',       'Aftertouch',           'enum',    '',       '{none,channel,polyphonic}', '', 70),
  ('keys',             'Keys',                 'integer', 'keys',   '{}', 'Keyboard size, where there is one.', 80),
  ('midi',             'MIDI',                 'list',    '',       '{din in,din out,din thru,usb,trs type a,trs type b,bluetooth}', '', 90),
  ('cv_gate',          'CV and gate',          'list',    '',       '{cv in,cv out,gate in,gate out,clock in,clock out}', '', 100),
  ('sync',             'Sync',                 'list',    '',       '{midi clock,din sync,analog clock,ableton link,usb}', '', 110),
  ('audio_inputs',     'Audio inputs',         'integer', '',       '{}', '', 120),
  ('audio_outputs',    'Audio outputs',        'integer', '',       '{}', '', 130),
  ('sampling',         'Sampling',             'boolean', '',       '{}', 'Can record audio into itself.', 140),
  ('sequencer',        'Sequencer',            'boolean', '',       '{}', '', 150),
  ('effects',          'Effects',              'text',    '',       '{}', 'Built-in effects, briefly.', 160),
  ('form_factor',      'Form factor',          'enum',    '',
     '{keyboard,desktop,rack,eurorack,pedal,controller,software,other}', '', 170)
on conflict (key) do nothing;

-- Values must match their definition. Used by the checks on both capability
-- tables below.
create or replace function capability_value_ok(p_key text, p_value jsonb) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $body$
declare
  d capability_defs;
begin
  select * into d from capability_defs where key = p_key;
  if not found then
    return false;
  end if;
  return case d.value_type
    when 'boolean' then jsonb_typeof(p_value) = 'boolean'
    when 'integer' then jsonb_typeof(p_value) = 'number' and (p_value::text)::numeric = trunc((p_value::text)::numeric)
    when 'number'  then jsonb_typeof(p_value) = 'number'
    when 'text'    then jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') <> ''
    when 'enum'    then jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') = any(d.choices)
    when 'list'    then jsonb_typeof(p_value) = 'array'
                        and not exists (
                          select 1 from jsonb_array_elements(p_value) e
                          where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all(d.choices)
                        )
  end;
end;
$body$;

create or replace function capability_value_check() returns trigger
language plpgsql as $body$
begin
  if not capability_value_ok(new.capability, new.value) then
    raise exception 'capability %: % is not a valid value', new.capability, new.value;
  end if;
  return new;
end;
$body$;

-- The model catalogue (platform-wide) ------------------------------------------------

create table if not exists gear_models (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('hardware', 'software', 'book', 'cable', 'other')),
  -- What it is, for questions like "which of my sound sources": a closed list
  -- so that a query can name it.
  category      text not null default 'other' check (category in (
                  'synthesizer', 'drum machine', 'sampler', 'groovebox', 'instrument',
                  'effect', 'mixer', 'interface', 'controller', 'monitor', 'microphone',
                  'instrument plugin', 'effect plugin', 'host', 'sample library',
                  'book', 'cable', 'power', 'other')),
  maker         text not null check (maker <> '' and maker = btrim(maker)),
  model         text not null check (model <> '' and model = btrim(model)),
  year          int check (year is null or year between 1900 and 2200),
  description   text not null default '',
  status        text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected')),
  suggested_by  text references accounts(user_id) default app_user(),
  created_at    timestamptz not null default now()
);
create unique index if not exists gear_models_maker_model on gear_models (lower(maker), lower(model));

-- The categories that make sound, for the question the catalogue must answer.
create or replace function is_sound_source(p_category text) returns boolean
language sql immutable as $body$
  select p_category in ('synthesizer', 'drum machine', 'sampler', 'groovebox', 'instrument',
                        'instrument plugin', 'sample library')
$body$;

-- A suggestion from anyone but the administrator arrives as 'suggested', and
-- only the administrator changes a model afterwards.
create or replace function gear_models_guard() returns trigger
language plpgsql as $body$
begin
  if app_user() is not null and not app_is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'suggested';
      new.suggested_by := app_user();
    else
      raise exception 'only the platform administrator changes the model catalogue';
    end if;
  end if;
  return new;
end;
$body$;
drop trigger if exists gear_models_guard on gear_models;
create trigger gear_models_guard before insert or update on gear_models
  for each row execute function gear_models_guard();

create table if not exists model_capabilities (
  model_id    bigint not null references gear_models(id) on delete cascade,
  capability  text not null references capability_defs(key) on update cascade,
  value       jsonb not null,
  primary key (model_id, capability)
);
drop trigger if exists model_capabilities_value on model_capabilities;
create trigger model_capabilities_value before insert or update on model_capabilities
  for each row execute function capability_value_check();

-- Units: one account's gear ---------------------------------------------------------

create table if not exists gear (
  id          bigint generated always as identity primary key,
  owner_id    text not null default app_user() references accounts(user_id),
  model_id    bigint references gear_models(id),
  -- A unit whose model is not in the catalogue (yet) names itself here.
  maker       text not null default '' check (maker = btrim(maker)),
  name        text not null default '' check (name = btrim(name)),
  nickname    text not null default '' check (nickname = btrim(nickname)),
  status      text not null default 'owned' check (status in ('owned', 'wishlist', 'gone')),
  firmware    text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  check (model_id is not null or name <> '')
);
create index if not exists gear_owner_idx on gear (owner_id);
create index if not exists gear_model_idx on gear (model_id);

-- The insurance record. Owner only (row-level security below), whatever the
-- unit is shared at. Created with the unit by the trigger that follows.
create table if not exists gear_private (
  gear_id            bigint primary key references gear(id) on delete cascade,
  serial             text not null default '',
  purchase_date      date,
  purchase_price     numeric(12,2) check (purchase_price is null or purchase_price >= 0),
  currency           text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  purchased_from     text not null default '',
  condition          text not null default '',
  location           text not null default '',
  service_history    text not null default '',
  license_key        text not null default '',
  license_seats      int check (license_seats is null or license_seats > 0),
  license_activation text not null default '',
  license_renewal    date
);

create or replace function gear_private_create() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  insert into gear_private (gear_id) values (new.id) on conflict do nothing;
  return null;
end;
$body$;
drop trigger if exists gear_private_create on gear;
create trigger gear_private_create after insert on gear
  for each row execute function gear_private_create();

-- Where a unit differs from its model.
create table if not exists gear_capabilities (
  gear_id     bigint not null references gear(id) on delete cascade,
  capability  text not null references capability_defs(key) on update cascade,
  value       jsonb not null,
  primary key (gear_id, capability)
);
drop trigger if exists gear_capabilities_value on gear_capabilities;
create trigger gear_capabilities_value before insert or update on gear_capabilities
  for each row execute function capability_value_check();

-- Photographs, receipts, serial plates and other files, in the private gear
-- bucket. Photos follow the unit's shares; the rest are owner only.
create table if not exists gear_files (
  id              bigint generated always as identity primary key,
  gear_id         bigint not null references gear(id) on delete cascade,
  role            text not null check (role in ('photo', 'receipt', 'serial_plate', 'document', 'other')),
  r2_key          text not null unique,
  filename        text not null,
  content_type    text not null default '',
  bytes           bigint,
  caption         text not null default '',
  uploaded_by_id  text references accounts(user_id) default app_user(),
  uploaded_at     timestamptz not null default now()
);
create index if not exists gear_files_gear_idx on gear_files (gear_id, role);

-- Effective level on a unit -----------------------------------------------------------

create or replace function gear_rank(p_gear_id bigint) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  owner text;
  best int := 0;
begin
  if me is null or not app_active() then
    return 0;
  end if;
  select owner_id into owner from gear where id = p_gear_id;
  if not found then
    return 0;
  end if;
  if owner = me then
    return 4;
  end if;
  select coalesce(max(level_rank(level)), 0) into best from shares where gear_id = p_gear_id and grantee_id = me;
  if best < 1 and app_admin_viewing() then
    best := 1;
  end if;
  return best;
end;
$body$;

create or replace function gear_level(p_gear_id bigint) returns text
language sql stable as $body$
  select case gear_rank(p_gear_id) when 4 then 'owner' when 3 then 'edit'
         when 2 then 'contribute' when 1 then 'view' else null end
$body$;

-- Each visible unit's capabilities: its own where it has them, else its
-- model's. A view that runs as the caller, so row-level security on the
-- underlying tables decides what it returns.
create or replace view gear_capabilities_effective with (security_invoker = true) as
  select g.id as gear_id, mc.capability, mc.value, false as overridden
  from gear g
  join model_capabilities mc on mc.model_id = g.model_id
  where not exists (select 1 from gear_capabilities gc where gc.gear_id = g.id and gc.capability = mc.capability)
  union all
  select gc.gear_id, gc.capability, gc.value, true as overridden
  from gear_capabilities gc;

-- Shares widen to gear ----------------------------------------------------------------

alter table shares add column if not exists gear_id bigint references gear(id) on delete cascade;
alter table shares drop constraint if exists shares_one_item;
alter table shares add constraint shares_one_item check (num_nonnulls(project_id, gear_id) = 1);
create unique index if not exists shares_gear_grantee on shares (gear_id, grantee_id) where gear_id is not null;

-- The share's item, whichever kind it is.
create or replace function share_item_rank(p_project_id bigint, p_gear_id bigint) returns int
language sql stable as $body$
  select case when p_project_id is not null then project_rank(p_project_id)
              when p_gear_id is not null then gear_rank(p_gear_id)
              else 0 end
$body$;

create or replace function shares_check_and_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  item_owner text;
  r shares;
  kind text;
  item bigint;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if r.project_id is not null then
    kind := 'project';
    item := r.project_id;
    select owner_id into item_owner from projects where id = r.project_id;
  else
    kind := 'gear';
    item := r.gear_id;
    select owner_id into item_owner from gear where id = r.gear_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.grantee_id = item_owner then
      raise exception 'an owner cannot share an item with themselves';
    end if;
    if not exists (select 1 from accounts where user_id = new.grantee_id and status = 'active') then
      raise exception 'account % is not active', new.grantee_id;
    end if;
  end if;

  if tg_op = 'INSERT' then
    perform log_access('share_granted', new.grantee_id, kind, item, null, jsonb_build_object('level', new.level), null);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.level is distinct from new.level then
      perform log_access('share_changed', new.grantee_id, kind, item,
        jsonb_build_object('level', old.level), jsonb_build_object('level', new.level), null);
    end if;
    return new;
  else
    perform log_access('share_revoked', old.grantee_id, kind, item, jsonb_build_object('level', old.level), null, null);
    return old;
  end if;
end;
$body$;

drop policy if exists shares_read on shares;
create policy shares_read on shares for select
  using (app_active() and (grantee_id = app_user() or share_item_rank(project_id, gear_id) = 4));
drop policy if exists shares_insert on shares;
create policy shares_insert on shares for insert
  with check (share_item_rank(project_id, gear_id) = 4 and granted_by = app_user());
drop policy if exists shares_update on shares;
create policy shares_update on shares for update
  using (share_item_rank(project_id, gear_id) = 4)
  with check (share_item_rank(project_id, gear_id) = 4);
drop policy if exists shares_delete on shares;
create policy shares_delete on shares for delete
  using (share_item_rank(project_id, gear_id) = 4);

-- Owners see the log entries about their gear, as about their projects.
drop policy if exists access_log_read on access_log;
create policy access_log_read on access_log for select
  using (
    app_is_admin()
    or (app_active() and (
      actor = app_user() or subject_id = app_user()
      or (item_kind = 'project' and project_rank(item_id) = 4)
      or (item_kind = 'gear' and gear_rank(item_id) = 4)
    ))
  );

-- Row-level security ------------------------------------------------------------------

alter table capability_defs    enable row level security;
alter table gear_models        enable row level security;
alter table model_capabilities enable row level security;
alter table gear               enable row level security;
alter table gear_private       enable row level security;
alter table gear_capabilities  enable row level security;
alter table gear_files         enable row level security;

-- The vocabulary: everyone active reads and adds; the administrator edits.
drop policy if exists capability_defs_read on capability_defs;
create policy capability_defs_read on capability_defs for select using (app_active());
drop policy if exists capability_defs_add on capability_defs;
create policy capability_defs_add on capability_defs for insert with check (app_active());
drop policy if exists capability_defs_edit on capability_defs;
create policy capability_defs_edit on capability_defs for update using (app_is_admin()) with check (app_is_admin());

-- The catalogue: approved models for everyone active; a suggestion for whoever
-- made it; everything for the administrator, who alone changes models and
-- their capabilities.
drop policy if exists gear_models_read on gear_models;
create policy gear_models_read on gear_models for select
  using (app_active() and (status = 'approved' or suggested_by = app_user() or app_is_admin()
         or exists (select 1 from gear g where g.model_id = gear_models.id and gear_rank(g.id) > 0)));
drop policy if exists gear_models_suggest on gear_models;
create policy gear_models_suggest on gear_models for insert with check (app_active());
drop policy if exists gear_models_edit on gear_models;
create policy gear_models_edit on gear_models for update using (app_is_admin()) with check (app_is_admin());
drop policy if exists gear_models_delete on gear_models;
create policy gear_models_delete on gear_models for delete using (app_is_admin());

drop policy if exists model_capabilities_read on model_capabilities;
create policy model_capabilities_read on model_capabilities for select
  using (exists (select 1 from gear_models m where m.id = model_id));   -- as visible as its model
drop policy if exists model_capabilities_write on model_capabilities;
create policy model_capabilities_write on model_capabilities for all
  using (app_is_admin()) with check (app_is_admin());

-- Units follow the project pattern: own, or shared.
drop policy if exists gear_read on gear;
create policy gear_read on gear for select
  using ((owner_id = app_user() and app_active()) or gear_rank(id) > 0);
drop policy if exists gear_insert on gear;
create policy gear_insert on gear for insert
  with check (app_active() and owner_id = app_user());
drop policy if exists gear_update on gear;
create policy gear_update on gear for update
  using (gear_rank(id) >= 3 and not app_admin_viewing())
  with check (gear_rank(id) >= 3);
drop policy if exists gear_delete on gear;
create policy gear_delete on gear for delete
  using (owner_id = app_user() and app_active());

-- The insurance record: the owner, and nobody else, ever. Not even the
-- administrator's read-only view.
drop policy if exists gear_private_owner on gear_private;
create policy gear_private_owner on gear_private for all
  using (gear_rank(gear_id) = 4)
  with check (gear_rank(gear_id) = 4);

drop policy if exists gear_capabilities_read on gear_capabilities;
create policy gear_capabilities_read on gear_capabilities for select using (gear_rank(gear_id) > 0);
drop policy if exists gear_capabilities_write on gear_capabilities;
create policy gear_capabilities_write on gear_capabilities for all
  using (gear_rank(gear_id) >= 3 and not app_admin_viewing())
  with check (gear_rank(gear_id) >= 3);

-- Photos follow the unit; receipts, serial plates and documents are the
-- owner's. Contributors may add photos; only the owner deletes.
drop policy if exists gear_files_read on gear_files;
create policy gear_files_read on gear_files for select
  using (gear_rank(gear_id) = 4 or (role = 'photo' and gear_rank(gear_id) > 0));
drop policy if exists gear_files_insert on gear_files;
create policy gear_files_insert on gear_files for insert
  with check (uploaded_by_id = app_user() and not app_admin_viewing()
              and (gear_rank(gear_id) = 4 or (role = 'photo' and gear_rank(gear_id) >= 2)));
drop policy if exists gear_files_update on gear_files;
create policy gear_files_update on gear_files for update
  using (gear_rank(gear_id) = 4) with check (gear_rank(gear_id) = 4);
drop policy if exists gear_files_delete on gear_files;
create policy gear_files_delete on gear_files for delete using (gear_rank(gear_id) = 4);

-- Grants -------------------------------------------------------------------------------

grant select on capability_defs, gear_models, model_capabilities, gear, gear_private,
  gear_capabilities, gear_files, gear_capabilities_effective to bottega_app;
grant insert on capability_defs, gear_models, model_capabilities, gear, gear_capabilities, gear_files to bottega_app;
grant update (label, unit, choices, description, position) on capability_defs to bottega_app;
grant update (kind, category, maker, model, year, description, status) on gear_models to bottega_app;
grant update (value) on model_capabilities, gear_capabilities to bottega_app;
grant update (model_id, maker, name, nickname, status, firmware, notes) on gear to bottega_app;
grant update (serial, purchase_date, purchase_price, currency, purchased_from, condition, location,
  service_history, license_key, license_seats, license_activation, license_renewal) on gear_private to bottega_app;
grant update (role, caption) on gear_files to bottega_app;
grant delete on gear_models, model_capabilities, gear, gear_capabilities, gear_files to bottega_app;
grant usage on all sequences in schema public to bottega_app;

commit;

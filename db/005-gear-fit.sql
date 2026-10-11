-- 005 — Gear fitted to the subject (REQUIREMENTS 0.8, §4), ahead of the
-- import of James's hardware list.
--
--   - "maker" becomes "manufacturer" on catalogue models, units and documents.
--   - A model's single year becomes the years it was made: introduced and
--     discontinued (null while in production).
--   - The category list gains sequencer, recorder, preamp, patchbay, MIDI
--     utility, amplifier, utility and test equipment.
--   - New capabilities: power, rack units, effect types. Form factor becomes a
--     list, since one unit can be desktop and rack at once.
--   - The insurance record gains an estimated value and the date of the
--     estimate.
--   - Documents gain three kinds: service manual, firmware notes, reference.
--     The library holds manufacturers' documents only: manuals, service
--     manuals and firmware notes. Reference material and books are private.
--
-- Requires 003 and 004. Safe to run twice.

begin;

-- manufacturer ---------------------------------------------------------------------------
-- A rename keeps the column's grants, checks and indexes; nothing in 003 or
-- 004 names the column inside a function body.

do $body$
begin
  if exists (select 1 from information_schema.columns where table_name = 'gear_models' and column_name = 'maker') then
    alter table gear_models rename column maker to manufacturer;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'gear' and column_name = 'maker') then
    alter table gear rename column maker to manufacturer;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'documents' and column_name = 'maker') then
    alter table documents rename column maker to manufacturer;
  end if;
end
$body$;
alter index if exists gear_models_maker_model rename to gear_models_manufacturer_model;
do $body$
declare r record;
begin
  -- The check constraints keep the old column name in their names; rename them too.
  for r in select conrelid::regclass as tbl, conname from pg_constraint
           where conname in ('gear_models_maker_check', 'gear_maker_check') loop
    execute format('alter table %s rename constraint %I to %I', r.tbl, r.conname, replace(r.conname, 'maker', 'manufacturer'));
  end loop;
end
$body$;

-- The years a model was made -------------------------------------------------------------

do $body$
begin
  if exists (select 1 from information_schema.columns where table_name = 'gear_models' and column_name = 'year') then
    alter table gear_models rename column year to year_introduced;
  end if;
end
$body$;
alter table gear_models add column if not exists year_discontinued int;
alter table gear_models drop constraint if exists gear_models_year_check;
alter table gear_models drop constraint if exists gear_models_years;
alter table gear_models add constraint gear_models_years check (
  (year_introduced is null or year_introduced between 1900 and 2200)
  and (year_discontinued is null or year_discontinued between 1900 and 2200)
  and (year_introduced is null or year_discontinued is null or year_discontinued >= year_introduced));
grant update (year_discontinued) on gear_models to bottega_app;

-- Categories -------------------------------------------------------------------------------

alter table gear_models drop constraint if exists gear_models_category_check;
alter table gear_models add constraint gear_models_category_check check (category in (
  'synthesizer', 'drum machine', 'sampler', 'groovebox', 'instrument', 'sequencer',
  'effect', 'mixer', 'interface', 'controller', 'monitor', 'microphone',
  'preamp', 'amplifier', 'recorder', 'patchbay', 'midi utility', 'utility', 'test equipment',
  'instrument plugin', 'effect plugin', 'host', 'sample library',
  'book', 'cable', 'power', 'other'));

-- Capabilities -----------------------------------------------------------------------------

insert into capability_defs (key, label, value_type, unit, choices, description, position) values
  ('power', 'Power', 'list', '',
     '{iec,fixed cord,fixed cord grounded,fixed cord ungrounded,dc adapter,usb,battery,eurorack bus,custom}',
     'How it is powered; "fixed cord ungrounded" matters when setting up a room.', 175),
  ('rack_units', 'Rack units', 'integer', 'U', '{}', 'Height in a 19-inch rack.', 180),
  ('effect_types', 'Effect types', 'list', '',
     '{reverb,spring reverb,plate reverb,delay,tape delay,analog delay,chorus,flanger,phaser,tremolo,filter,ring modulator,distortion,compressor,limiter,gate,eq,pitch shift,vocoder,vocal processor,spatializer,slicer,multi-effects}',
     'What a processor does, so effects can be found by kind.', 165)
on conflict (key) do nothing;

-- Form factor: an enum becomes a list. Existing values become one-item lists.
update capability_defs set value_type = 'list' where key = 'form_factor' and value_type = 'enum';
update model_capabilities set value = jsonb_build_array(value)
  where capability = 'form_factor' and jsonb_typeof(value) = 'string';
update gear_capabilities set value = jsonb_build_array(value)
  where capability = 'form_factor' and jsonb_typeof(value) = 'string';

-- The insurance record ---------------------------------------------------------------------

alter table gear_private add column if not exists estimated_value numeric(12,2)
  check (estimated_value is null or estimated_value >= 0);
alter table gear_private add column if not exists valued_on date;
grant update (estimated_value, valued_on) on gear_private to bottega_app;

-- Document kinds ---------------------------------------------------------------------------

alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check
  check (kind in ('manual', 'service', 'firmware', 'reference', 'book', 'other'));
alter table documents drop constraint if exists documents_library_kinds;
alter table documents add constraint documents_library_kinds
  check (not library or kind in ('manual', 'service', 'firmware'));

commit;

-- Tests for db/008-processor-category.sql. Unlike the others, this one runs
-- 008 itself: it seeds effect models first, so the reclassification has
-- something to act on.
--
-- Run once against a fresh scratch database with 001–007 applied (008 is
-- applied here), never Neon.
--
--   psql -d bottega_test -f db/test/008-processor-category.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

create schema if not exists tst;
create or replace function tst.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.cat(m text) returns text language sql as $$ select category from gear_models where model = m $$;

insert into gear_models (kind, category, manufacturer, model, status) values
  ('hardware', 'effect', 'Schippman', 'Ebbe und Flut', 'approved'),
  ('hardware', 'effect', 'Boss', 'SL-20', 'approved'),
  ('hardware', 'effect', 'Strymon', 'BigSky', 'approved'),
  ('hardware', 'effect', 'Ensoniq', 'DP/4+', 'approved');
insert into model_capabilities (model_id, capability, value)
  select id, 'effect_types', '["filter"]' from gear_models where model = 'Ebbe und Flut';
insert into model_capabilities (model_id, capability, value)
  select id, 'effect_types', '["slicer", "gate"]' from gear_models where model = 'SL-20';
insert into model_capabilities (model_id, capability, value)
  select id, 'effect_types', '["multi-effects", "delay", "reverb", "chorus"]' from gear_models where model = 'DP/4+';

\i db/008-processor-category.sql

select tst.expect(tst.cat('Ebbe und Flut') = 'processor', 'a filter becomes a processor');
select tst.expect(tst.cat('SL-20') = 'effect', 'a slicer with a gate stays an effect');
select tst.expect(tst.cat('BigSky') = 'effect', 'an effect with no types recorded stays an effect');
select tst.expect(tst.cat('DP/4+') = 'effect', 'a multi-effects unit stays an effect');
insert into gear_models (kind, category, manufacturer, model, status) values ('hardware', 'processor', 'Empirical Labs', 'Distressor', 'approved');
select tst.expect(tst.cat('Distressor') = 'processor', 'processor is a category');

\echo 008 processor category tests passed

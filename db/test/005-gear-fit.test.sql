-- Tests for db/005-gear-fit.sql: manufacturer, production years, the new
-- categories and capabilities, the estimated value on the insurance record,
-- and which document kinds the library takes.
--
-- Run once against a fresh scratch database with 001–005 applied, never Neon.
--
--   psql -d bottega_test -f db/test/005-gear-fit.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('C', 'c@x', 'Chris', 'active', false)
on conflict (user_id) do nothing;
select set_config('app.actor', '', false);

create schema if not exists tst; grant usage on schema tst to bottega_app;
create or replace function tst.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.refused(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok: % (%)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % was allowed', what;
end $$;
grant execute on all functions in schema tst to bottega_app;

-- Models: manufacturer, years, categories -------------------------------------------
insert into gear_models (kind, category, manufacturer, model, year_introduced, year_discontinued, status)
  values ('hardware', 'synthesizer', 'ARP', 'Pro Soloist', 1972, 1977, 'approved'),
         ('hardware', 'sequencer', 'Arturia', 'BeatStep Pro', 2015, null, 'approved'),
         ('hardware', 'test equipment', 'B&K', 'Signal Generator', null, null, 'approved');
select tst.expect((select count(*) from gear_models) = 3, 'manufacturer, a range of years and the new categories are accepted');
select tst.refused($$insert into gear_models (kind, manufacturer, model, year_introduced, year_discontinued)
                     values ('hardware', 'X', 'Backwards', 1990, 1980)$$, 'discontinued before introduced');
select tst.refused($$insert into gear_models (kind, category, manufacturer, model) values ('hardware', 'toaster', 'X', 'Y')$$,
  'a category outside the list');
select tst.refused($$insert into gear_models (kind, manufacturer, model) values ('hardware', '', 'Nameless')$$,
  'an empty manufacturer');

-- Capabilities ---------------------------------------------------------------------------
insert into model_capabilities (model_id, capability, value)
  select id, 'form_factor', '["desktop", "rack"]' from gear_models where model = 'Signal Generator';
insert into model_capabilities (model_id, capability, value)
  select id, 'power', '["fixed cord ungrounded"]' from gear_models where model = 'Pro Soloist';
insert into model_capabilities (model_id, capability, value)
  select id, 'rack_units', '2' from gear_models where model = 'Signal Generator';
select tst.expect((select count(*) from model_capabilities) = 3, 'form factor as a list, power and rack units');
select tst.refused($$insert into model_capabilities (model_id, capability, value)
                     select id, 'form_factor', '"desktop"' from gear_models where model = 'BeatStep Pro'$$,
  'form factor as a single value');
select tst.refused($$insert into model_capabilities (model_id, capability, value)
                     select id, 'effect_types', '["kazoo"]' from gear_models where model = 'BeatStep Pro'$$,
  'an effect type outside the list');

-- The estimated value is the owner's, like the rest of the insurance record --------------
set role bottega_app;
select set_config('app.user_id', 'J', false);
insert into gear (model_id) select id from gear_models where model = 'Pro Soloist';
update gear_private set estimated_value = 450, valued_on = '2026-10-11';
select tst.expect((select estimated_value = 450 from gear_private), 'the owner records an estimated value');
select set_config('app.user_id', 'C', false);
select tst.expect(not exists (select 1 from gear_private), 'nobody else sees it');
reset role;

-- Document kinds -------------------------------------------------------------------------
set role bottega_app;
select set_config('app.user_id', 'C', false);
insert into documents (library, kind, title, r2_key, filename, bytes, sha256)
  values (true, 'service', 'Pro Soloist Service Manual', 'library/s.pdf', 's.pdf', 1, repeat('1', 64));
select tst.refused($$insert into documents (library, kind, title, r2_key, filename, bytes, sha256)
                     values (true, 'reference', 'The MPC Bible', 'library/r.pdf', 'r.pdf', 1, repeat('2', 64))$$,
  'reference material in the library');
insert into documents (library, kind, title, r2_key, filename, bytes, sha256)
  values (false, 'reference', 'The MPC Bible', 'a/C/documents/r.pdf', 'r.pdf', 1, repeat('2', 64));
select tst.expect((select count(*) from documents) = 2, 'a service manual in the library, reference material kept private');
reset role;

select set_config('app.user_id', '', false);
\echo 005 gear fit tests passed

-- Tests for db/006-gear-file-visibility.sql: who sees a gear file is its own
-- public flag, not its role; rotation is checked; only the owner changes
-- either.
--
-- Run once against a fresh scratch database with 001–006 applied, never Neon.
--
--   psql -d bottega_test -f db/test/006-gear-file-visibility.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('C', 'c@x', 'Chris', 'active', false), ('G', 'g@x', 'Gordon', 'active', false)
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
create or replace function tst.affects(stmt text, n int, what text) returns void language plpgsql as $$
declare got int;
begin
  execute stmt;
  get diagnostics got = row_count;
  if got <> n then raise exception 'FAILED: % (touched %, expected %)', what, got, n; end if;
  raise notice 'ok: %', what;
end $$;
create or replace function tst.unit() returns bigint language sql security definer as $$ select id from gear where name = 'Juno-60' $$;
grant execute on all functions in schema tst to bottega_app;

-- James's unit, shared with Chris at contribute; Gordon has no share.
set role bottega_app;
select set_config('app.user_id', 'J', false);
insert into gear (name, manufacturer) values ('Juno-60', 'Roland');
insert into gear_files (gear_id, role, r2_key, filename, content_type, public) values
  (tst.unit(), 'photo', 'k/front', 'front.jpg', 'image/jpeg', true),
  (tst.unit(), 'photo', 'k/scratch', 'scratch.jpg', 'image/jpeg', false),
  (tst.unit(), 'serial_plate', 'k/serial', 'serial.jpg', 'image/jpeg', false),
  (tst.unit(), 'receipt', 'k/receipt', 'receipt.pdf', 'application/pdf', false);
insert into shares (gear_id, grantee_id, level, granted_by) values (tst.unit(), 'C', 'contribute', 'J');

select set_config('app.user_id', 'C', false);
select tst.expect((select array_agg(filename order by filename) from gear_files) = array['front.jpg'],
  'a grantee sees public files only, and a private photo is hidden like a receipt');
insert into gear_files (gear_id, role, r2_key, filename, content_type, public)
  values (tst.unit(), 'photo', 'k/chris', 'chris.jpg', 'image/jpeg', true);
select tst.refused($$insert into gear_files (gear_id, role, r2_key, filename, content_type, public)
                     values (tst.unit(), 'photo', 'k/hidden', 'hidden.jpg', 'image/jpeg', false)$$,
  'a contributor adding a private photo');
select tst.affects($$update gear_files set rotation = 90 where filename = 'front.jpg'$$, 0, 'a contributor turning a photo');

select set_config('app.user_id', 'G', false);
select tst.expect(not exists (select 1 from gear_files), 'without a share, nothing');

select set_config('app.user_id', 'J', false);
select tst.expect((select count(*) from gear_files) = 5, 'the owner sees every file');
select tst.affects($$update gear_files set public = true where filename = 'scratch.jpg'$$, 1, 'the owner makes a photo public');
select tst.affects($$update gear_files set rotation = 270 where filename = 'front.jpg'$$, 1, 'the owner turns a photo');
select tst.refused($$update gear_files set rotation = 45 where filename = 'front.jpg'$$, 'a rotation that is not a quarter turn');
select set_config('app.admin_view', 'on', false);
select set_config('app.user_id', 'J', false);
select set_config('app.admin_view', '', false);

select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) from gear_files) = 3, 'the grantee now sees the photo made public');
select tst.expect((select rotation from gear_files where filename = 'front.jpg') = 270, 'and sees it turned');
reset role;

-- The administrator's read-only view of another account sees public files only.
set role bottega_app;
select set_config('app.user_id', 'G', false);
insert into gear (name, manufacturer) values ('TR-606', 'Roland');
insert into gear_files (gear_id, role, r2_key, filename, content_type, public)
  select id, 'photo', 'k/g1', 'g-public.jpg', 'image/jpeg', true from gear where name = 'TR-606';
insert into gear_files (gear_id, role, r2_key, filename, content_type, public)
  select id, 'serial_plate', 'k/g2', 'g-serial.jpg', 'image/jpeg', false from gear where name = 'TR-606';
select set_config('app.user_id', 'J', false);
select set_config('app.admin_view', 'on', false);
select tst.expect((select array_agg(filename) from gear_files where filename like 'g-%') = array['g-public.jpg'],
  'the administrator''s view sees public files only');
select set_config('app.admin_view', '', false);
reset role;

select set_config('app.user_id', '', false);
\echo 006 gear file visibility tests passed

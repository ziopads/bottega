-- Tests for db/007-image-variants.sql: image folders and their variants, the
-- owner's conversion of an older image, and my_usage().
--
-- Run once against a fresh scratch database with 001–007 applied, never Neon.
--
--   psql -d bottega_test -f db/test/007-image-variants.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'James', 'active', true), ('C', 'c@x', 'Chris', 'active', false), ('P', 'p@x', 'Pending', 'pending', false)
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
create or replace function tst.unit() returns bigint language sql security definer as $$ select id from gear where name = 'MS-20' $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'J', false);
insert into gear (name, manufacturer) values ('MS-20', 'Korg');

-- Folders and variants -------------------------------------------------------------------
insert into gear_files (gear_id, role, r2_key, filename, content_type, bytes, public, variants, width, height)
  values (tst.unit(), 'photo', 'a/J/gear/1/f1/', 'front.heic', 'image/webp', 900000, true,
          '{thumb.webp,view.webp,full.webp}', 2560, 1920);
select tst.expect((select cardinality(variants) = 3 from gear_files where filename = 'front.heic'), 'an image folder with three variants');
select tst.refused($$insert into gear_files (gear_id, role, r2_key, filename, content_type, variants)
                     values (tst.unit(), 'photo', 'a/J/gear/1/f2.webp', 'x.jpg', 'image/webp', '{thumb.webp}')$$,
  'variants on a key that is not a folder');
select tst.refused($$insert into gear_files (gear_id, role, r2_key, filename, content_type)
                     values (tst.unit(), 'photo', 'a/J/gear/1/f3/', 'x.jpg', 'image/webp')$$,
  'a folder with no variants');
select tst.refused($$insert into gear_files (gear_id, role, r2_key, filename, content_type, variants)
                     values (tst.unit(), 'photo', 'a/J/gear/1/f4/', 'x.jpg', 'image/webp', '{../escape.webp}')$$,
  'a variant name that is a path');

-- An older image, converted by its owner ----------------------------------------------------
insert into gear_files (gear_id, role, r2_key, filename, content_type, bytes, public)
  values (tst.unit(), 'photo', 'a/J/gear/1/old.jpg', 'old.jpg', 'image/jpeg', 4000000, true);
insert into gear_files (gear_id, role, r2_key, filename, content_type, bytes)
  values (tst.unit(), 'receipt', 'a/J/gear/1/receipt.pdf', 'receipt.pdf', 'application/pdf', 200000);
insert into shares (gear_id, grantee_id, level, granted_by) values (tst.unit(), 'C', 'edit', 'J');

select set_config('app.user_id', 'C', false);
select tst.affects($$update gear_files set r2_key = 'a/J/gear/1/f5/', variants = '{full.webp}' where filename = 'old.jpg'$$, 0,
  'an editor cannot convert someone else''s image');

select set_config('app.user_id', 'J', false);
select tst.affects($$update gear_files set r2_key = 'a/J/gear/1/f5/', variants = '{thumb.webp,view.webp,full.webp}',
                     bytes = 700000, content_type = 'image/webp', width = 2000, height = 1500 where filename = 'old.jpg'$$, 1,
  'the owner converts an older image');

-- my_usage() ----------------------------------------------------------------------------------
select tst.expect((select files = 2 and bytes = 1600000 from my_usage() where kind = 'gear images'),
  'gear images counted with their files and bytes');
select tst.expect((select files = 1 and bytes = 200000 from my_usage() where kind = 'gear documents'),
  'gear documents counted apart');
select tst.expect((select sum(bytes) from my_usage()) = storage_used('J'), 'the kinds add up to storage_used()');
select tst.expect(storage_room('J') is null, 'the administrator has no storage limit');
reset role;
insert into account_limits (user_id, storage_bytes) values ('C', 1000000);
set role bottega_app;
select set_config('app.user_id', 'C', false);
select tst.expect(storage_room('C') = 1000000, 'room is the allowance less what is stored');
select tst.expect(storage_room('J') is null, 'a collaborator sees the owner''s room, not their own');
select tst.expect((select sum(bytes) from my_usage()) = 0, 'a grantee''s usage does not include the owner''s files');
select set_config('app.user_id', 'P', false);
select tst.expect(not exists (select 1 from my_usage() where files > 0), 'a pending account has no usage');
reset role;

select set_config('app.user_id', '', false);
\echo 007 image variants tests passed

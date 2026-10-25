-- Tests for db/027-watcher-macs.sql: adding a Mac with its folder, the
-- one-time setup code, trading it for a token, the Mac's settings, and
-- removing it.
--
-- Run once against a fresh scratch database with 001–027 applied, never Neon.
--
--   psql -d bottega_test -f db/test/027-watcher-macs.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status) values ('J', 'j@x', 'Person A', 'active'), ('G', 'g@x', 'Person C', 'active')
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
create or replace function tst.h(s text) returns text language sql as $$ select encode(sha256(convert_to(s, 'UTF8')), 'hex') $$;
create or replace function tst.mac(n text) returns watcher_macs language sql security definer as $$ select * from watcher_macs where name = n $$;
create or replace function tst.tok(i bigint) returns personal_tokens language sql security definer as $$ select * from personal_tokens where id = i $$;
create or replace function tst.expire(n text) returns void language sql security definer as
  $$ update watcher_macs set setup_expires_at = now() - interval '1 minute' where name = n $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'J', false);
select tst.expect(mac_add('Studio Mac', '/Volumes/VIGORISH/AUDIO   ABL VIGORISH SESSIONS', tst.h('CODE-ONE')) is not null, 'a person adds a Mac with its folder');
select tst.expect((select count(*) = 1 and bool_and(root = '/Volumes/VIGORISH/AUDIO   ABL VIGORISH SESSIONS' and token_id is null) from watcher_macs),
                  'they read its name and folder, spaces kept, no token yet');
select tst.refused('select setup_hash from watcher_macs', 'never the code''s hash');
select tst.refused(format('select mac_add(%L, %L, %L)', 'Laptop', 'Music/Sessions', tst.h('x')), 'a folder is a full path');

select set_config('app.user_id', '', false);
select tst.expect((select count(*) = 0 from mac_claim(tst.h('WRONG'), tst.h('btg_secret1'), 'btg_aaaaaaaa')), 'a wrong code gets nothing');
select tst.expect((select name = 'Studio Mac' and user_id = 'J' from mac_claim(tst.h('CODE-ONE'), tst.h('btg_secret1'), 'btg_aaaaaaaa')),
                  'the right code, before anyone is known, gets the Mac''s settings');
select tst.expect((select count(*) = 1 from token_verify(tst.h('btg_secret1'), 'sets')), 'and a working token');
select tst.expect((select count(*) = 0 from mac_claim(tst.h('CODE-ONE'), tst.h('btg_secret2'), 'btg_bbbbbbbb')), 'a code works once');

select set_config('app.user_id', 'J', false);
select tst.expect(((tst.mac('Studio Mac')).token_id is not null and (tst.tok((tst.mac('Studio Mac')).token_id)).name = 'Studio Mac'),
                  'the token is the Mac''s, named after it');
select tst.expect((select root from mac_config((tst.mac('Studio Mac')).token_id)) = '/Volumes/VIGORISH/AUDIO   ABL VIGORISH SESSIONS',
                  'the watcher reads its folder');
select mac_update((tst.mac('Studio Mac')).id, null, '/Volumes/OTHER/Sessions');
select tst.expect((select root from mac_config((tst.mac('Studio Mac')).token_id)) = '/Volumes/OTHER/Sessions', 'a folder changed in Bottega reaches the watcher');
select watcher_report((tst.mac('Studio Mac')).token_id, '1.1.0', 'studio', '/Volumes/OTHER/Sessions', 0, '{}', false);
select tst.expect((select root_found = false from watcher_reports), 'the watcher says it did not find the folder');

-- Installing again: a new code, a new token, the old one revoked.
create temporary table old_token as select (tst.mac('Studio Mac')).token_id as id;
select mac_new_code((tst.mac('Studio Mac')).id, tst.h('CODE-TWO'));
select tst.expect((select count(*) = 1 from mac_claim(tst.h('CODE-TWO'), tst.h('btg_secret3'), 'btg_cccccccc')), 'a new code installs again');
select tst.expect(((tst.tok((select id from old_token))).revoked_at is not null), 'the Mac''s old token is revoked');
select set_config('app.user_id', '', false);
select tst.expect((select count(*) = 0 from token_verify(tst.h('btg_secret1'), 'sets')), 'and stops working');

select set_config('app.user_id', 'J', false);
select mac_new_code((tst.mac('Studio Mac')).id, tst.h('CODE-THREE'));
select tst.expire('Studio Mac');
select set_config('app.user_id', '', false);
select tst.expect((select count(*) = 0 from mac_claim(tst.h('CODE-THREE'), tst.h('btg_secret4'), 'btg_dddddddd')), 'an expired code gets nothing');

select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 0 from watcher_macs), 'another person sees no Mac of yours');
select tst.refused(format('select mac_update(%s, %L, null)', (tst.mac('Studio Mac')).id, 'Mine'), 'nor renames it');
select tst.refused(format('select mac_new_code(%s, %L)', (tst.mac('Studio Mac')).id, tst.h('G-CODE')), 'nor makes it a code');
select tst.refused(format('select mac_remove(%s)', (tst.mac('Studio Mac')).id), 'nor removes it');

select set_config('app.user_id', 'J', false);
select mac_remove((tst.mac('Studio Mac')).id);
select tst.expect(((tst.mac('Studio Mac')).removed_at is not null), 'the owner removes the Mac');
select set_config('app.user_id', '', false);
select tst.expect((select count(*) = 0 from token_verify(tst.h('btg_secret3'), 'sets')), 'which stops its token at once');

reset role;
select tst.expect((select count(*) from access_log where action = 'watcher_mac_added') = 1, 'adding is logged');
select tst.expect((select count(*) from access_log where action = 'watcher_mac_installed') = 2, 'each install is logged');
select tst.expect((select count(*) from access_log where action = 'watcher_mac_removed') = 1, 'removing is logged');
select 'all 027 tests passed' as result;

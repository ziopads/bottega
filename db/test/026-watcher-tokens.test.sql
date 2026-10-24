-- Tests for db/026-watcher-tokens.sql: creating, using and revoking personal
-- access tokens, their privacy, and the watcher's reports.
--
-- Run once against a fresh scratch database with 001–026 applied, never Neon.
--
--   psql -d bottega_test -f db/test/026-watcher-tokens.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status) values
  ('J', 'j@x', 'James', 'active'), ('G', 'g@x', 'Gordon', 'active'), ('P', 'p@x', 'Pending', 'pending')
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
create or replace function tst.tid(n text) returns bigint language sql security definer as $$ select id from personal_tokens where name = n $$;
create or replace function tst.log(a text) returns bigint language sql security definer as $$ select count(*) from access_log where action = a $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;

select set_config('app.user_id', 'J', false);
select tst.expect(token_create('Studio Mac', tst.h('secret-one'), 'btg_abcd') is not null, 'a person creates a token');
select tst.expect(tst.log('personal_token_created') = 1, 'which is logged');
select tst.expect((select count(*) = 1 and bool_and(name = 'Studio Mac' and prefix = 'btg_abcd' and last_used_at is null) from personal_tokens),
                  'and reads its name and prefix');
select tst.refused('select hash from personal_tokens', 'never its hash');
select tst.refused($$insert into personal_tokens (user_id, name, hash, prefix) values ('J', 'x', repeat('a', 64), 'btg_x')$$, 'no direct writes');
select tst.refused(format('select token_create(%L, %L, %L)', 'Dup', tst.h('secret-one'), 'btg_dddd'), 'one secret, one token');

select set_config('app.user_id', '', false);
select tst.expect((select user_id = 'J' and token_id = tst.tid('Studio Mac') from token_verify(tst.h('secret-one'), 'sets')),
                  'the secret signs in as its owner, before anyone is known');
select tst.expect((select count(*) = 0 from token_verify(tst.h('wrong'), 'sets')), 'a wrong secret signs in as nobody');

select set_config('app.user_id', 'G', false);
select tst.expect((select count(*) = 0 from personal_tokens), 'another person sees none of it');
select token_revoke(tst.tid('Studio Mac'));
select set_config('app.user_id', '', false);
select tst.expect((select count(*) = 1 from token_verify(tst.h('secret-one'), 'sets')), 'nor revokes it');

select set_config('app.user_id', 'J', false);
select tst.expect((select last_used_at is not null from personal_tokens where name = 'Studio Mac'), 'its last use is recorded');
select watcher_report(tst.tid('Studio Mac'), '1.0.0', 'studio.local', '/Volumes/VIGORISH/x', 3, array['2025 0901 sketch Project']);
select tst.expect((select pending = 3 and unmatched = array['2025 0901 sketch Project'] from watcher_reports), 'the watcher reports what waits and what it could not match');
select watcher_report(tst.tid('Studio Mac'), '1.0.1', 'studio.local', '/Volumes/VIGORISH/x', 0, '{}');
select tst.expect((select count(*) = 1 and bool_and(version = '1.0.1' and pending = 0) from watcher_reports), 'a later report replaces it');
select set_config('app.user_id', 'G', false);
select tst.refused(format('select watcher_report(%s, %L, %L, %L, 0, %L::text[])', tst.tid('Studio Mac'), 'x', 'x', 'x', '{}'), 'nobody reports on another''s token');
select tst.expect((select count(*) = 0 from watcher_reports), 'nor reads its reports');

select set_config('app.user_id', 'J', false);
select token_revoke(tst.tid('Studio Mac'));
select tst.expect(tst.log('personal_token_revoked') = 1, 'revoking is logged');
select set_config('app.user_id', '', false);
select tst.expect((select count(*) = 0 from token_verify(tst.h('secret-one'), 'sets')), 'a revoked token signs in as nobody');

select set_config('app.user_id', 'J', false);
select token_create('Laptop', tst.h('secret-two'), 'btg_efgh');
reset role;
update accounts set status = 'disabled' where user_id = 'J';
set role bottega_app;
select set_config('app.user_id', '', false);
select tst.expect((select count(*) = 0 from token_verify(tst.h('secret-two'), 'sets')), 'a disabled account''s tokens stop at once');

select set_config('app.user_id', 'P', false);
select tst.refused(format('select token_create(%L, %L, %L)', 'x', tst.h('secret-three'), 'btg_zzzz'), 'an account awaiting approval creates none');

reset role;
select 'all 026 tests passed' as result;

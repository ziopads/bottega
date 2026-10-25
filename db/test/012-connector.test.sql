-- Tests for db/012-connector.sql: the connector's codes and tokens.
--
-- Run once against a fresh scratch database with 001–012 applied, never Neon.
--
--   psql -d bottega_test -f db/test/012-connector.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

select set_config('app.actor', 'bootstrap', false);
insert into accounts (user_id, email, display_name, status, is_platform_admin) values
  ('J', 'j@x', 'Person A', 'active', true), ('C', 'c@x', 'Person B', 'active', false), ('P', 'p@x', '', 'pending', false)
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
create or replace function tst.h(s text) returns text language sql immutable as $$ select encode(sha256(convert_to(s, 'UTF8')), 'hex') $$;
grant execute on all functions in schema tst to bottega_app;

set role bottega_app;
select set_config('app.user_id', 'C', false);

select tst.refused($$select * from oauth_tokens$$, 'the app role cannot read the table');
select tst.refused($$insert into oauth_tokens (hash, kind, client_id, user_id, expires_at) values (tst.h('x'), 'access', 'c', 'J', now() + interval '1 hour')$$,
                   'nor write it');
select oauth_issue_code(tst.h('code1'), 'https://claude.ai/meta', 'https://claude.ai/cb', 'chal', 600);
select tst.expect((select count(*) = 1 from access_log where action = 'token_issued' and subject_id = 'C'), 'consent is logged');

-- The exchange is anonymous (no person set): the code is the authority.
select set_config('app.user_id', '', false);
select tst.expect(oauth_exchange_code(tst.h('code1'), 'https://claude.ai/other', 'https://claude.ai/cb', 'chal', tst.h('a1'), tst.h('r1'), 3600, 86400)
                  = 'the code was issued to another client', 'another client is refused');
select tst.expect(oauth_exchange_code(tst.h('code1'), 'https://claude.ai/meta', 'https://claude.ai/cb', 'chal', tst.h('a1'), tst.h('r1'), 3600, 86400)
                  = 'the code is unknown, used or expired', 'a refused code is spent');
select set_config('app.user_id', 'C', false);
select oauth_issue_code(tst.h('code2'), 'https://claude.ai/meta', 'https://claude.ai/cb', 'chal', 600);
select set_config('app.user_id', '', false);
select tst.expect(oauth_exchange_code(tst.h('code2'), 'https://claude.ai/meta', 'https://claude.ai/cb', 'wrong', tst.h('a1'), tst.h('r1'), 3600, 86400)
                  = 'PKCE verification failed', 'a wrong verifier is refused');
select set_config('app.user_id', 'C', false);
select oauth_issue_code(tst.h('code3'), 'https://claude.ai/meta', 'https://claude.ai/cb', 'chal', 600);
select set_config('app.user_id', '', false);
select tst.expect(oauth_exchange_code(tst.h('code3'), 'https://claude.ai/meta', 'https://claude.ai/cb', 'chal', tst.h('a1'), tst.h('r1'), 3600, 86400)
                  is null, 'a matching code becomes a token pair');
select tst.expect((select user_id = 'C' from oauth_verify(tst.h('a1'))), 'the access token names its account');
select tst.expect((select count(*) = 0 from oauth_verify(tst.h('r1'))), 'a refresh token is not an access token');
select tst.expect(oauth_exchange_refresh(tst.h('r1'), 'https://claude.ai/meta', tst.h('a2'), tst.h('r2'), 3600, 86400) is null,
                  'a refresh token becomes a new pair');
select tst.expect(oauth_exchange_refresh(tst.h('r1'), 'https://claude.ai/meta', tst.h('a3'), tst.h('r3'), 3600, 86400)
                  = 'the refresh token is unknown, used or expired', 'and only once');

select set_config('app.user_id', 'P', false);
select tst.refused($$select oauth_issue_code(tst.h('code4'), 'c', 'r', 'chal', 600)$$, 'a pending account cannot connect');

reset role;
select set_config('app.actor', 'bootstrap', false);
update accounts set status = 'disabled' where user_id = 'C';
set role bottega_app;
select tst.expect((select count(*) = 0 from oauth_verify(tst.h('a2'))), 'a disabled account''s token stops working');
reset role;
update accounts set status = 'active' where user_id = 'C';
select set_config('app.actor', '', false);
set role bottega_app;

select set_config('app.user_id', 'C', false);
select tst.expect((select count(*) = 1 from my_connector_clients()), 'the person sees their connected client');
select set_config('app.user_id', 'J', false);
select tst.expect((select count(*) = 0 from my_connector_clients()), 'and nobody else does');
select tst.expect(oauth_revoke_mine(null) = 0, 'revoking one''s own touches nobody else');
select set_config('app.user_id', 'C', false);
select tst.expect(oauth_revoke_mine('https://claude.ai/meta') = 3, 'revoking ends the client''s tokens (two access, one refresh)');
select tst.expect((select count(*) = 0 from oauth_verify(tst.h('a2'))), 'the access token no longer works');
select tst.expect((select count(*) = 1 from access_log where action = 'token_revoked' and subject_id = 'C'), 'the revocation is logged');

reset role;
select 'all 012 tests passed' as result;

-- Tests for db/021-sign-in-attempts.sql: the attempt limit on sign-in and
-- sign-up, called with no person set.
--
-- Run once against a fresh scratch database with 001–021 applied, never Neon.
--
--   psql -d bottega_test -f db/test/021-sign-in-attempts.test.sql
\set ON_ERROR_STOP 1
\set QUIET 1

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

set role bottega_app;
select set_config('app.user_id', '', false);

select tst.expect(auth_attempt_wait('sign-in', 'c@x', '1.2.3.4') = 0, 'a first attempt goes ahead');
select auth_attempt_record('sign-in', 'c@x', '1.2.3.4', false) from generate_series(1, 4);
select tst.expect(auth_attempt_wait('sign-in', 'C@X ', '9.9.9.9') = 0, 'four failures still allow a fifth');
select auth_attempt_record('sign-in', 'c@x', '1.2.3.4', false);
select tst.expect(auth_attempt_wait('sign-in', 'c@x', '9.9.9.9') > 0, 'five failures for one email wait, from any address');
select tst.expect(auth_attempt_wait('sign-in', 'g@x', '9.9.9.9') = 0, 'another email is unaffected');

-- A success clears the count for that email.
select auth_attempt_record('sign-in', 'c@x', '1.2.3.4', true);
select tst.expect(auth_attempt_wait('sign-in', 'c@x', '1.2.3.4') = 0, 'a success clears the earlier failures');

-- One address trying many emails.
select auth_attempt_record('sign-in', 'user' || n || '@x', '5.5.5.5', false) from generate_series(1, 20) n;
select tst.expect(auth_attempt_wait('sign-in', 'fresh@x', '5.5.5.5') > 0, 'twenty failures from one address wait');

-- Sign-up by address.
select auth_attempt_record('sign-up', 'new' || n || '@x', '7.7.7.7', true) from generate_series(1, 5) n;
select tst.expect(auth_attempt_wait('sign-up', 'another@x', '7.7.7.7') > 0, 'five sign-ups from one address in an hour wait');
select tst.expect(auth_attempt_wait('sign-up', 'another@x', '8.8.8.8') = 0, 'another address may sign up');

select tst.refused($$select count(*) from auth_attempts$$, 'the application role reading the attempts');
select tst.refused($$select auth_attempt_wait('reset', 'a', 'b')$$, 'an unknown kind');

reset role;
select tst.expect((select count(*) = 0 from auth_attempts where email_hash like '%@%' or addr_hash like '%.%'), 'nothing is stored in clear');
select 'all 021 tests passed' as result;

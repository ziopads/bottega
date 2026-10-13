-- 021 — A limit of our own on sign-in and sign-up attempts (decided 12
-- October 2026).
--
-- Neon Auth limits attempts per address, but every sign-in reaches it from
-- the server, so it sees Vercel's address for everyone and cannot single out
-- one person guessing passwords. Bottega keeps its own short record:
--
--   - auth_attempts: when, what (sign-in or sign-up), whether it succeeded,
--     and SHA-256 hashes of the email and of the caller's address (Vercel's
--     x-forwarded-for), so no stranger's email or address is stored as such.
--     Rows older than a day are dropped as new ones arrive.
--   - auth_attempt_wait(kind, email, address): the seconds to wait before
--     another attempt, 0 when it may go ahead. Sign-in: after 5 failures for
--     one email, or 20 from one address, within 15 minutes (failures before
--     that email's last success do not count). Sign-up: after 5 from one
--     address within an hour.
--   - auth_attempt_record(kind, email, address, ok): records one.
--
-- Both are called before anyone is signed in, as the application role with no
-- person set; the table itself is not granted to it.
--
-- Safe to run twice.

begin;

create table if not exists auth_attempts (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('sign-in', 'sign-up')),
  email_hash  text not null,
  addr_hash   text not null,
  ok          boolean not null
);
create index if not exists auth_attempts_email_idx on auth_attempts (email_hash, at desc);
create index if not exists auth_attempts_addr_idx on auth_attempts (addr_hash, at desc);
alter table auth_attempts enable row level security;   -- no policy: the application role reads nothing

create or replace function auth_hash(p text) returns text
language sql immutable as $body$
  select encode(sha256(convert_to(lower(btrim(coalesce(p, ''))), 'UTF8')), 'hex')
$body$;

create or replace function auth_attempt_wait(p_kind text, p_email text, p_addr text) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $body$
declare
  e text := auth_hash(p_email);
  a text := auth_hash(p_addr);
  since_ok timestamptz;
  oldest timestamptz;
  n int;
begin
  if p_kind = 'sign-in' then
    select max(at) into since_ok from auth_attempts where kind = 'sign-in' and email_hash = e and ok;
    select count(*), min(at) into n, oldest from (
      select at from auth_attempts
       where kind = 'sign-in' and email_hash = e and not ok and at > now() - interval '15 minutes'
         and (since_ok is null or at > since_ok)
       order by at desc limit 5) x;
    if n >= 5 then
      return greatest(1, ceil(extract(epoch from (oldest + interval '15 minutes' - now())))::int);
    end if;
    select count(*), min(at) into n, oldest from (
      select at from auth_attempts
       where kind = 'sign-in' and addr_hash = a and not ok and at > now() - interval '15 minutes'
       order by at desc limit 20) x;
    if n >= 20 then
      return greatest(1, ceil(extract(epoch from (oldest + interval '15 minutes' - now())))::int);
    end if;
    return 0;
  elsif p_kind = 'sign-up' then
    select count(*), min(at) into n, oldest from (
      select at from auth_attempts
       where kind = 'sign-up' and addr_hash = a and at > now() - interval '1 hour'
       order by at desc limit 5) x;
    if n >= 5 then
      return greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now())))::int);
    end if;
    return 0;
  end if;
  raise exception 'no attempt kind %', p_kind;
end;
$body$;

create or replace function auth_attempt_record(p_kind text, p_email text, p_addr text, p_ok boolean) returns void
language sql security definer set search_path = public, pg_temp as $body$
  delete from auth_attempts where at < now() - interval '1 day';
  insert into auth_attempts (kind, email_hash, addr_hash, ok) values (p_kind, auth_hash(p_email), auth_hash(p_addr), p_ok);
$body$;

revoke all on auth_attempts from bottega_app;
revoke execute on function auth_attempt_wait(text, text, text) from public;
revoke execute on function auth_attempt_record(text, text, text, boolean) from public;
grant execute on function auth_attempt_wait(text, text, text) to bottega_app;
grant execute on function auth_attempt_record(text, text, text, boolean) to bottega_app;

commit;

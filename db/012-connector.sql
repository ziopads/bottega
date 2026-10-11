-- 012 — The connector's OAuth codes and tokens (REQUIREMENTS M-1, AC-11;
-- ARCHITECTURE §6).
--
-- Claude reaches Bottega through the remote MCP endpoint (app/api/mcp). Neon
-- Auth cannot act as an OAuth provider, so the application issues tokens
-- itself on top of the ordinary sign-in, as Scriptorium does (lib/oauth.ts).
-- One table holds the three kinds of secret the flow hands out:
--
--   code      the one-time authorization code, 10 minutes, with the
--             redirect_uri and PKCE challenge it was issued against
--   access    the bearer token Claude sends with every MCP request, 1 hour
--   refresh   exchanged for a new access and refresh token, 30 days, and
--             deleted when used (rotation)
--
-- Only a SHA-256 hash of each value is stored: the values are 32 random bytes,
-- so a leaked table yields nothing usable. Each row carries the account it
-- was issued to, and every MCP request runs as that account (AC-10).
--
-- The application role cannot read or write the table. It goes through the
-- functions below, which are the rules:
--
--   oauth_issue_code      the signed-in, active person consents; logged as
--                         token_issued
--   oauth_exchange_code   a code becomes an access and refresh pair, once,
--                         when client, redirect and PKCE all match
--   oauth_exchange_refresh  a refresh token becomes a new pair, once
--   oauth_verify          an access token names its account, if active
--   my_connector_clients  the person's connected clients, for the account page
--   oauth_revoke_mine     the person ends a client's access (or all); logged
--                         as token_revoked
--
-- A disabled account's tokens stop working at once: the exchange and verify
-- functions check the account's status every time.
--
-- Requires 002. Safe to run twice.

begin;

create table if not exists oauth_tokens (
  hash            text primary key check (hash ~ '^[0-9a-f]{64}$'),
  kind            text not null check (kind in ('code', 'access', 'refresh')),
  client_id       text not null,
  user_id         text not null references accounts(user_id) on delete cascade,
  redirect_uri    text,
  code_challenge  text,
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null
);
create index if not exists oauth_tokens_user_idx on oauth_tokens (user_id, client_id);
create index if not exists oauth_tokens_expires_idx on oauth_tokens (expires_at);

alter table oauth_tokens enable row level security;
-- No policies and no grants: only the functions below touch it.
revoke all on oauth_tokens from bottega_app;

create or replace function oauth_account_active(p_user text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select exists (select 1 from accounts where user_id = p_user and status = 'active')
$body$;

create or replace function oauth_issue_code(
  p_hash text, p_client text, p_redirect text, p_challenge text, p_seconds int
) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if app_user() is null or not app_active() then
    raise exception 'connecting Claude needs an active account';
  end if;
  if p_seconds not between 60 and 900 then
    raise exception 'a code lives between one and fifteen minutes';
  end if;
  insert into oauth_tokens (hash, kind, client_id, user_id, redirect_uri, code_challenge, expires_at)
  values (p_hash, 'code', p_client, app_user(), p_redirect, p_challenge, now() + make_interval(secs => p_seconds));
  perform log_access('token_issued', app_user(), null, null, null, jsonb_build_object('client_id', p_client), null);
end;
$body$;

-- Both exchanges delete the old row and return why they refused, or null
-- with the new pair stored. Delete-and-check in one statement makes a code or
-- refresh token single-use even when two requests race.
create or replace function oauth_exchange_code(
  p_code_hash text, p_client text, p_redirect text, p_verifier_s256 text,
  p_access_hash text, p_refresh_hash text, p_access_seconds int, p_refresh_seconds int
) returns text
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  r oauth_tokens;
begin
  delete from oauth_tokens where hash = p_code_hash and kind = 'code' returning * into r;
  if not found or r.expires_at < now() then
    return 'the code is unknown, used or expired';
  end if;
  if r.client_id <> p_client then
    return 'the code was issued to another client';
  end if;
  if r.redirect_uri is distinct from p_redirect then
    return 'redirect_uri does not match';
  end if;
  if r.code_challenge is distinct from p_verifier_s256 then
    return 'PKCE verification failed';
  end if;
  if not oauth_account_active(r.user_id) then
    return 'this account no longer has access';
  end if;
  insert into oauth_tokens (hash, kind, client_id, user_id, expires_at) values
    (p_access_hash, 'access', r.client_id, r.user_id, now() + make_interval(secs => p_access_seconds)),
    (p_refresh_hash, 'refresh', r.client_id, r.user_id, now() + make_interval(secs => p_refresh_seconds));
  delete from oauth_tokens where expires_at < now();
  return null;
end;
$body$;

create or replace function oauth_exchange_refresh(
  p_refresh_hash text, p_client text,
  p_access_hash text, p_new_refresh_hash text, p_access_seconds int, p_refresh_seconds int
) returns text
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  r oauth_tokens;
begin
  delete from oauth_tokens where hash = p_refresh_hash and kind = 'refresh' returning * into r;
  if not found or r.expires_at < now() then
    return 'the refresh token is unknown, used or expired';
  end if;
  if p_client <> '' and r.client_id <> p_client then
    return 'the refresh token was issued to another client';
  end if;
  if not oauth_account_active(r.user_id) then
    return 'this account no longer has access';
  end if;
  insert into oauth_tokens (hash, kind, client_id, user_id, expires_at) values
    (p_access_hash, 'access', r.client_id, r.user_id, now() + make_interval(secs => p_access_seconds)),
    (p_new_refresh_hash, 'refresh', r.client_id, r.user_id, now() + make_interval(secs => p_refresh_seconds));
  return null;
end;
$body$;

create or replace function oauth_verify(p_hash text)
returns table (user_id text, client_id text, expires_epoch bigint)
language sql stable security definer set search_path = public, pg_temp as $body$
  select t.user_id, t.client_id, extract(epoch from t.expires_at)::bigint
    from oauth_tokens t
   where t.hash = p_hash and t.kind = 'access' and t.expires_at > now() and oauth_account_active(t.user_id)
$body$;

create or replace function my_connector_clients()
returns table (client_id text, connected_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $body$
  select t.client_id, min(t.issued_at), max(t.expires_at)
    from oauth_tokens t
   where t.user_id = app_user() and app_active() and t.kind in ('access', 'refresh') and t.expires_at > now()
   group by t.client_id
   order by 2
$body$;

-- Ends one client's access, or every client's with null. Returns the rows removed.
create or replace function oauth_revoke_mine(p_client text) returns int
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  n int;
begin
  if app_user() is null or not app_active() then
    raise exception 'revoking access needs an active account';
  end if;
  delete from oauth_tokens where user_id = app_user() and (p_client is null or client_id = p_client);
  get diagnostics n = row_count;
  if n > 0 then
    perform log_access('token_revoked', app_user(), null, null, null,
      jsonb_build_object('client_id', coalesce(p_client, 'all')), null);
  end if;
  return n;
end;
$body$;

-- log_event (002) already lists token_issued and token_revoked for the app;
-- these functions write them directly, so the actor is always the person.

revoke execute on function oauth_account_active(text) from public;
revoke execute on function oauth_issue_code(text, text, text, text, int) from public;
revoke execute on function oauth_exchange_code(text, text, text, text, text, text, int, int) from public;
revoke execute on function oauth_exchange_refresh(text, text, text, text, int, int) from public;
revoke execute on function oauth_verify(text) from public;
revoke execute on function my_connector_clients() from public;
revoke execute on function oauth_revoke_mine(text) from public;
grant execute on function oauth_issue_code(text, text, text, text, int) to bottega_app;
grant execute on function oauth_exchange_code(text, text, text, text, text, text, int, int) to bottega_app;
grant execute on function oauth_exchange_refresh(text, text, text, text, int, int) to bottega_app;
grant execute on function oauth_verify(text) to bottega_app;
grant execute on function my_connector_clients() to bottega_app;
grant execute on function oauth_revoke_mine(text) to bottega_app;

commit;

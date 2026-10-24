-- 027 — Each Mac a person runs the watcher on, set up from Bottega with a
-- one-time code (REQUIREMENTS A-10 to A-12; decided 24 October 2026).
--
--   - watcher_macs: a Mac by name, with its own sessions folder (a studio Mac
--     and a laptop can differ). Adding one makes a setup code, shown in an
--     install command; only its hash is kept, it lasts fifteen minutes and
--     works once. mac_claim() trades the code for a personal access token
--     (026) made for that Mac, revoking any token the Mac had before, so
--     the secret is never shown on a page. The watcher reads its name and
--     folder from here (mac_config()) at every start and sweep, so a folder
--     changed in Bottega reaches the Mac without anything being run there.
--   - watcher_reports gains root_found: whether the Mac found its folder.
--   - Removing a Mac revokes its token; tokens made by hand under 026 keep
--     working, outside any Mac.
--
-- Requires 026. Safe to run twice.

begin;

create table if not exists watcher_macs (
  id                bigint generated always as identity primary key,
  user_id           text not null references accounts(user_id) on delete cascade,
  name              text not null check (name = btrim(name) and name <> '' and char_length(name) <= 80),
  root              text not null check (root = btrim(root) and root like '/%' and char_length(root) <= 1024),
  token_id          bigint references personal_tokens(id) on delete set null,
  setup_hash        text unique check (setup_hash ~ '^[0-9a-f]{64}$'),
  setup_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  removed_at        timestamptz
);
create index if not exists watcher_macs_user_idx on watcher_macs (user_id);

alter table watcher_reports add column if not exists root_found boolean;

create or replace function mac_owner_check(p_mac bigint) returns watcher_macs
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  m watcher_macs;
begin
  if app_user() is null or not app_active() or app_admin_viewing() then
    raise exception 'setting up a Mac needs an active account';
  end if;
  select * into m from watcher_macs where id = p_mac and user_id = app_user() and removed_at is null;
  if not found then
    raise exception 'that Mac is not one of yours';
  end if;
  return m;
end;
$body$;

-- Adds a Mac with a setup code (its hash, made by the app); returns its id.
create or replace function mac_add(p_name text, p_root text, p_code_hash text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  new_id bigint;
begin
  if me is null or not app_active() or app_admin_viewing() then
    raise exception 'setting up a Mac needs an active account';
  end if;
  if (select count(*) from watcher_macs where user_id = me and removed_at is null) >= 10 then
    raise exception 'ten Macs at most: remove one first';
  end if;
  insert into watcher_macs (user_id, name, root, setup_hash, setup_expires_at)
  values (me, btrim(coalesce(p_name, '')), btrim(coalesce(p_root, '')), p_code_hash, now() + interval '15 minutes')
  returning id into new_id;
  perform log_access('watcher_mac_added', me, null, null, null, jsonb_build_object('name', btrim(p_name)), null);
  return new_id;
end;
$body$;

create or replace function mac_update(p_mac bigint, p_name text, p_root text) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  perform mac_owner_check(p_mac);
  update watcher_macs
     set name = coalesce(btrim(p_name), name), root = coalesce(btrim(p_root), root)
   where id = p_mac;
end;
$body$;

-- A fresh setup code, to install again or on a Mac set up anew.
create or replace function mac_new_code(p_mac bigint, p_code_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  perform mac_owner_check(p_mac);
  update watcher_macs set setup_hash = p_code_hash, setup_expires_at = now() + interval '15 minutes' where id = p_mac;
end;
$body$;

-- Removing a Mac revokes its token at once.
create or replace function mac_remove(p_mac bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  m watcher_macs;
begin
  m := mac_owner_check(p_mac);
  update watcher_macs set removed_at = now(), setup_hash = null, setup_expires_at = null where id = p_mac;
  update personal_tokens set revoked_at = coalesce(revoked_at, now()) where id = m.token_id;
  perform log_access('watcher_mac_removed', m.user_id, null, null, jsonb_build_object('name', m.name), null, null);
end;
$body$;

-- The installer trades a setup code for a token made for that Mac; called
-- before anyone is known. Returns the Mac's id, name and folder, or nothing
-- when the code is wrong, used or expired.
create or replace function mac_claim(p_code_hash text, p_token_hash text, p_token_prefix text)
returns table (mac_id bigint, user_id text, name text, root text)
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  m watcher_macs;
  t bigint;
begin
  update watcher_macs w set setup_hash = null, setup_expires_at = null
   where w.setup_hash = p_code_hash and w.setup_expires_at > now() and w.removed_at is null
     and exists (select 1 from accounts a where a.user_id = w.user_id and a.status = 'active')
  returning * into m;
  if not found then
    return;
  end if;
  update personal_tokens set revoked_at = coalesce(revoked_at, now()) where id = m.token_id;
  insert into personal_tokens (user_id, name, hash, prefix) values (m.user_id, m.name, p_token_hash, p_token_prefix) returning id into t;
  update watcher_macs set token_id = t where id = m.id;
  perform set_config('app.actor', m.user_id, true);
  perform log_access('watcher_mac_installed', m.user_id, null, null, null, jsonb_build_object('name', m.name), null);
  return query select m.id, m.user_id, m.name, m.root;
end;
$body$;

-- The Mac a token belongs to, for the watcher: its name and folder.
create or replace function mac_config(p_token bigint) returns table (mac_id bigint, name text, root text)
language sql stable security definer set search_path = public, pg_temp as $body$
  select id, name, root from watcher_macs
   where token_id = p_token and user_id = app_user() and removed_at is null
$body$;

-- watcher_report as in 026, with whether the folder was found. The six-
-- argument form stays, calling this one, so code deployed before 027 keeps
-- working until the new code is out.
create or replace function watcher_report(p_token bigint, p_version text, p_host text, p_root text, p_pending int, p_unmatched text[], p_root_found boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
begin
  if me is null or not exists (select 1 from personal_tokens where id = p_token and user_id = me and revoked_at is null) then
    raise exception 'that token is not yours';
  end if;
  insert into watcher_reports (token_id, user_id, reported_at, version, host, root, pending, unmatched, root_found)
  values (p_token, me, now(), left(coalesce(p_version, ''), 40), left(coalesce(p_host, ''), 120), left(coalesce(p_root, ''), 1024),
          greatest(coalesce(p_pending, 0), 0), coalesce(p_unmatched[1:500], '{}'), p_root_found)
  on conflict (token_id) do update
    set reported_at = now(), version = excluded.version, host = excluded.host, root = excluded.root,
        pending = excluded.pending, unmatched = excluded.unmatched, root_found = excluded.root_found;
end;
$body$;

create or replace function watcher_report(p_token bigint, p_version text, p_host text, p_root text, p_pending int, p_unmatched text[])
returns void
language sql security definer set search_path = public, pg_temp as $body$
  select watcher_report(p_token, p_version, p_host, p_root, p_pending, p_unmatched, null::boolean)
$body$;

alter table watcher_macs enable row level security;
drop policy if exists watcher_macs_read on watcher_macs;
create policy watcher_macs_read on watcher_macs for select using (user_id = app_user());

revoke all on watcher_macs from bottega_app;
grant select (id, user_id, name, root, token_id, setup_expires_at, created_at, removed_at) on watcher_macs to bottega_app;

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'mac_add(text, text, text)', 'mac_update(bigint, text, text)', 'mac_new_code(bigint, text)', 'mac_remove(bigint)',
    'mac_claim(text, text, text)', 'mac_config(bigint)', 'watcher_report(bigint, text, text, text, int, text[], boolean)',
    'mac_owner_check(bigint)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to bottega_app', f);
  end loop;
end;
$grants$;

commit;

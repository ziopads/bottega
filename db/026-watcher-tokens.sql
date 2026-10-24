-- 026 — Personal access tokens and the Mac watcher's reports (REQUIREMENTS
-- A-9, AC-15; decided 23 October 2026).
--
--   - personal_tokens: a secret a person creates under Account › Security for
--     a program of theirs, today the Mac watcher, which sends saved Live sets
--     and folder listings as them. Only the SHA-256 of the secret is stored,
--     with its first characters to tell tokens apart. A token has one scope,
--     'sets': the watcher's routes accept nothing else. Revoking is final.
--     token_create(), token_revoke() and token_verify() are the only ways in;
--     the table has no grants for the hash. Creating and revoking go to the
--     access log; a disabled account's tokens stop working at once.
--   - watcher_reports: the latest report from each of a person's watchers:
--     when it last called, its version and host name, how many sets wait to
--     be sent, and the folders it found no project for (listed, never
--     guessed or created).
--
-- Requires 002. Safe to run twice.

begin;

create table if not exists personal_tokens (
  id            bigint generated always as identity primary key,
  user_id       text not null references accounts(user_id) on delete cascade,
  name          text not null check (name = btrim(name) and name <> '' and char_length(name) <= 80),
  scope         text not null default 'sets' check (scope in ('sets')),
  hash          text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  prefix        text not null check (prefix ~ '^[A-Za-z0-9_-]{4,16}$'),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists personal_tokens_user_idx on personal_tokens (user_id);

create table if not exists watcher_reports (
  token_id     bigint primary key references personal_tokens(id) on delete cascade,
  user_id      text not null references accounts(user_id) on delete cascade,
  reported_at  timestamptz not null default now(),
  version      text not null default '' check (char_length(version) <= 40),
  host         text not null default '' check (char_length(host) <= 120),
  root         text not null default '' check (char_length(root) <= 1024),
  pending      int not null default 0 check (pending >= 0),
  unmatched    text[] not null default '{}' check (cardinality(unmatched) <= 500)
);

-- Creates a token for the signed-in person from the hash of a secret the app
-- made and shows once. Returns its id.
create or replace function token_create(p_name text, p_hash text, p_prefix text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  new_id bigint;
begin
  if me is null or not app_active() or app_admin_viewing() then
    raise exception 'creating a token needs an active account';
  end if;
  if (select count(*) from personal_tokens where user_id = me and revoked_at is null) >= 10 then
    raise exception 'ten tokens at most: revoke one first';
  end if;
  insert into personal_tokens (user_id, name, hash, prefix) values (me, btrim(coalesce(p_name, '')), p_hash, p_prefix)
  returning id into new_id;
  perform log_access('personal_token_created', me, null, null, null, jsonb_build_object('name', btrim(p_name), 'prefix', p_prefix), null);
  return new_id;
end;
$body$;

create or replace function token_revoke(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  t personal_tokens;
begin
  if me is null or not app_active() or app_admin_viewing() then
    raise exception 'revoking a token needs an active account';
  end if;
  update personal_tokens set revoked_at = now() where id = p_id and user_id = me and revoked_at is null returning * into t;
  if found then
    perform log_access('personal_token_revoked', me, null, null, jsonb_build_object('name', t.name, 'prefix', t.prefix), null, null);
  end if;
end;
$body$;

-- The account and token a secret's hash belongs to, while the token is live
-- and the account active; records the use. Called before anyone is known.
create or replace function token_verify(p_hash text, p_scope text)
returns table (user_id text, token_id bigint)
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  return query
  update personal_tokens t set last_used_at = now()
    from accounts a
   where t.hash = p_hash and t.scope = p_scope and t.revoked_at is null
     and a.user_id = t.user_id and a.status = 'active'
  returning t.user_id, t.id;
end;
$body$;

-- A watcher's report, as the person its token belongs to.
create or replace function watcher_report(p_token bigint, p_version text, p_host text, p_root text, p_pending int, p_unmatched text[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
begin
  if me is null or not exists (select 1 from personal_tokens where id = p_token and user_id = me and revoked_at is null) then
    raise exception 'that token is not yours';
  end if;
  insert into watcher_reports (token_id, user_id, reported_at, version, host, root, pending, unmatched)
  values (p_token, me, now(), left(coalesce(p_version, ''), 40), left(coalesce(p_host, ''), 120), left(coalesce(p_root, ''), 1024),
          greatest(coalesce(p_pending, 0), 0), coalesce(p_unmatched[1:500], '{}'))
  on conflict (token_id) do update
    set reported_at = now(), version = excluded.version, host = excluded.host, root = excluded.root,
        pending = excluded.pending, unmatched = excluded.unmatched;
end;
$body$;

alter table personal_tokens enable row level security;
alter table watcher_reports enable row level security;

drop policy if exists personal_tokens_read on personal_tokens;
create policy personal_tokens_read on personal_tokens for select using (user_id = app_user());
drop policy if exists watcher_reports_read on watcher_reports;
create policy watcher_reports_read on watcher_reports for select using (user_id = app_user());

-- Everything but the hash.
revoke all on personal_tokens from bottega_app;
grant select (id, user_id, name, scope, prefix, created_at, last_used_at, revoked_at) on personal_tokens to bottega_app;
grant select on watcher_reports to bottega_app;

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'token_create(text, text, text)', 'token_revoke(bigint)', 'token_verify(text, text)',
    'watcher_report(bigint, text, text, text, int, text[])'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to bottega_app', f);
  end loop;
end;
$grants$;

commit;

-- 010 — Account settings: a name of one's own choosing, and preferences
-- (REQUIREMENTS AC-13).
--
--   - set_my_display_name(name): the signed-in person changes the name others
--     see on shares, notes and uploads. accounts has no update grant, so this
--     function is the only way, and it writes the change to the access log.
--     register_session already keeps a name once one is set.
--   - account_preferences: one row per account, readable and writable by that
--     account only. For now it holds the artist new sessions start with; it
--     must be one of the account's own artists, and is cleared if that
--     artist is deleted.
--
-- Requires 002. Safe to run twice.

begin;

create or replace function set_my_display_name(p_name text) returns text
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  n text := btrim(coalesce(p_name, ''));
  old_name text;
begin
  if me is null or not app_active() then
    raise exception 'set_my_display_name needs an active account';
  end if;
  if n = '' then
    raise exception 'a display name cannot be empty';
  end if;
  if char_length(n) > 80 then
    raise exception 'a display name can be at most 80 characters';
  end if;
  select display_name into old_name from accounts where user_id = me;
  if old_name is distinct from n then
    update accounts set display_name = n where user_id = me;
    perform log_access('display_name_changed', me, null, null,
      jsonb_build_object('display_name', old_name), jsonb_build_object('display_name', n), null);
  end if;
  return n;
end;
$body$;
revoke execute on function set_my_display_name(text) from public;
grant execute on function set_my_display_name(text) to bottega_app;

create table if not exists account_preferences (
  user_id            text primary key default app_user() references accounts(user_id) on delete cascade,
  default_artist_id  bigint references artists(id) on delete set null,
  updated_at         timestamptz not null default now()
);

-- The default artist is one of the account's own. Runs as the owner, so the
-- check sees the artist whatever the policies would show.
create or replace function account_preferences_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if new.default_artist_id is not null
     and not exists (select 1 from artists where id = new.default_artist_id and account_id = new.user_id) then
    raise exception 'the default artist must be one of your own artists';
  end if;
  new.updated_at := now();
  return new;
end;
$body$;
drop trigger if exists account_preferences_check on account_preferences;
create trigger account_preferences_check before insert or update on account_preferences
  for each row execute function account_preferences_check();

alter table account_preferences enable row level security;
drop policy if exists account_preferences_read on account_preferences;
create policy account_preferences_read on account_preferences for select
  using (app_active() and user_id = app_user());
drop policy if exists account_preferences_insert on account_preferences;
create policy account_preferences_insert on account_preferences for insert
  with check (app_active() and user_id = app_user());
drop policy if exists account_preferences_update on account_preferences;
create policy account_preferences_update on account_preferences for update
  using (app_active() and user_id = app_user())
  with check (user_id = app_user());

grant select, insert on account_preferences to bottega_app;
grant update (default_artist_id) on account_preferences to bottega_app;

commit;

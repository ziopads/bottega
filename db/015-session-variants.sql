-- 015 — Session variants: a session's main mix and its named variants (a
-- radio edit, an extended mix), each with its own saved Live sets and its own
-- mixes (REQUIREMENTS S-14, S-16).
--
--   - session_variants: the variants a session has, beside the main mix
--     (which is the empty name, as in audio.variant, and has no row). Each
--     has a name rule: text in a saved set's file name ("radio edit") that
--     puts the save in the variant. Created by edit access; renamed through
--     rename_session_variant(), which renames the variant's mixes and saves
--     with it; removed by the owner through delete_session_variant(), only
--     while it has no mixes.
--   - audio.variant must name one of the session's variants (or be '' for
--     the main mix); a name differing only in case is written as the
--     variant's own spelling. Mixes uploaded before this keep their variant:
--     each distinct name becomes a variant here.
--   - als_snapshots.variant: the variant a save belongs to. Set by the name
--     rules (the longest rule found in the file name wins; no rule found
--     means the main mix) unless variant_by_hand, when a person chose it.
--     Rules are applied again whenever a variant is added, renamed or
--     removed.
--
-- The workflow, the references and notes about the whole session stay
-- common to all variants. Notes on a mix follow the mix.
--
-- Requires 013 and 014. Safe to run twice.

begin;

create table if not exists session_variants (
  id          bigint generated always as identity primary key,
  project_id  bigint not null references projects(id) on delete cascade,
  name        text not null check (name = btrim(name) and name <> '' and char_length(name) <= 40
                                   and lower(name) not in ('main', 'main mix')),
  match       text not null check (match = btrim(match) and match <> '' and char_length(match) <= 60),
  created_by  text not null default app_user() references accounts(user_id),
  created_at  timestamptz not null default now()
);
create unique index if not exists session_variants_name_idx on session_variants (project_id, lower(name));

alter table als_snapshots add column if not exists variant text not null default '';
alter table als_snapshots add column if not exists variant_by_hand boolean not null default false;
create index if not exists als_snapshots_variant_idx on als_snapshots (project_id, variant, saved_at);

-- ── Mixes uploaded before 015 ──────────────────────────────────────────────
-- One spelling per name: the first uploaded.
with canon as (
  select distinct on (project_id, lower(variant)) project_id, lower(variant) as lv, variant
    from audio where role = 'mix' and variant <> ''
   order by project_id, lower(variant), uploaded_at, id
)
update audio a set variant = c.variant
  from canon c
 where a.project_id = c.project_id and lower(a.variant) = c.lv and a.variant <> c.variant;

insert into session_variants (project_id, name, match, created_by)
select distinct on (a.project_id, lower(a.variant)) a.project_id, a.variant, lower(a.variant), p.owner_id
  from audio a join projects p on p.id = a.project_id
 where a.role = 'mix' and a.variant <> ''
 order by a.project_id, lower(a.variant), a.uploaded_at, a.id
on conflict (project_id, lower(name)) do nothing;

-- ── A mix's variant is one of the session's ───────────────────────────────
create or replace function audio_variant_known() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  v text;
begin
  if new.variant = '' then return new; end if;
  select name into v from session_variants where project_id = new.project_id and lower(name) = lower(new.variant);
  if v is null then
    raise exception 'This session has no variant named "%".', new.variant using errcode = '23503';
  end if;
  new.variant := v;
  return new;
end;
$body$;
drop trigger if exists audio_variant_known on audio;
create trigger audio_variant_known before insert or update of variant on audio
  for each row execute function audio_variant_known();

-- ── A save's variant, by name rule or by hand ─────────────────────────────
create or replace function variant_for_file(p_project bigint, p_file text) returns text
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce((
    select name from session_variants
     where project_id = p_project and position(lower(match) in lower(p_file)) > 0
     order by char_length(match) desc, id
     limit 1), '')
$body$;

create or replace function als_snapshots_variant() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  v text;
begin
  if not new.variant_by_hand then
    new.variant := variant_for_file(new.project_id, new.file_name);
  elsif new.variant <> '' then
    select name into v from session_variants where project_id = new.project_id and lower(name) = lower(new.variant);
    if v is null then
      raise exception 'This session has no variant named "%".', new.variant using errcode = '23503';
    end if;
    new.variant := v;
  end if;
  return new;
end;
$body$;
drop trigger if exists als_snapshots_variant on als_snapshots;
create trigger als_snapshots_variant before insert or update of file_name, variant, variant_by_hand on als_snapshots
  for each row execute function als_snapshots_variant();

-- Rules changed: sort the session's saves again (those chosen by hand stay).
create or replace function session_variants_resort() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  update als_snapshots set variant_by_hand = false
   where project_id = coalesce(new.project_id, old.project_id) and not variant_by_hand;
  return null;
end;
$body$;
drop trigger if exists session_variants_resort on session_variants;
create trigger session_variants_resort after insert or update or delete on session_variants
  for each row execute function session_variants_resort();

-- Saves already read: sorted by the variants above.
update als_snapshots set variant_by_hand = false where not variant_by_hand;

-- ── Renaming and removing ─────────────────────────────────────────────────
create or replace function rename_session_variant(p_id bigint, p_name text, p_match text) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  r session_variants;
begin
  select * into r from session_variants where id = p_id;
  if r.id is null or project_rank(r.project_id) < 3 or app_admin_viewing() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update session_variants set name = p_name, match = p_match where id = p_id;
  if r.name <> p_name then
    update audio set variant = p_name where project_id = r.project_id and variant = r.name;
    update als_snapshots set variant = p_name where project_id = r.project_id and variant_by_hand and variant = r.name;
  end if;
end;
$body$;

create or replace function delete_session_variant(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  r session_variants;
begin
  select * into r from session_variants where id = p_id;
  if r.id is null or project_rank(r.project_id) < 4 or app_admin_viewing() then
    raise exception 'Only the session''s owner removes a variant.' using errcode = '42501';
  end if;
  if exists (select 1 from audio where project_id = r.project_id and role = 'mix' and variant = r.name) then
    raise exception 'The variant "%" still has mixes; delete them first.', r.name using errcode = '23503';
  end if;
  delete from session_variants where id = p_id;
  update als_snapshots set variant_by_hand = false where project_id = r.project_id and variant_by_hand and variant = r.name;
end;
$body$;

-- ── Access ────────────────────────────────────────────────────────────────
alter table session_variants enable row level security;
drop policy if exists session_variants_read on session_variants;
create policy session_variants_read on session_variants for select using (project_rank(project_id) > 0);
drop policy if exists session_variants_insert on session_variants;
create policy session_variants_insert on session_variants for insert
  with check (project_rank(project_id) >= 3 and created_by = app_user() and not app_admin_viewing());

grant select, insert on session_variants to bottega_app;
grant update (variant, variant_by_hand) on als_snapshots to bottega_app;
grant execute on function rename_session_variant(bigint, text, text), delete_session_variant(bigint) to bottega_app;
grant usage on all sequences in schema public to bottega_app;

commit;

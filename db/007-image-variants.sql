-- 007 — Images stored as web versions in a folder of their own, and what an
-- account uses, by kind (REQUIREMENTS G-10, O-7).
--
--   - An image on a unit is a folder in R2 holding sized web versions made in
--     the browser before upload (thumb, view, full; the original is not
--     kept). gear_files.r2_key is then the folder, ending in '/', and
--     `variants` names the files in it ('thumb.webp', 'view.webp',
--     'full.webp'); `bytes` is their total, so storage_used() counts every
--     object. Rows from before 007 have no variants: r2_key is the original
--     file, until the owner's browser converts it.
--   - width and height are the full version's, before rotation.
--   - my_usage() breaks the signed-in person's storage down by kind, with
--     file counts, for the account page; storage_room(owner) is what an
--     account may still store, checked before an upload is signed.
--
-- Requires 004 and 006. Safe to run twice.

begin;

alter table gear_files add column if not exists variants text[] not null default '{}';
alter table gear_files add column if not exists width int check (width is null or width > 0);
alter table gear_files add column if not exists height int check (height is null or height > 0);

-- A folder key ends in '/', and only a folder has variants; each variant is a
-- plain file name.
create or replace function variant_names_ok(p_variants text[]) returns boolean
language sql immutable as $body$
  select coalesce(bool_and(v ~ '^[a-z]+\.(webp|jpg)$'), true) from unnest(p_variants) v
$body$;
alter table gear_files drop constraint if exists gear_files_variants;
alter table gear_files add constraint gear_files_variants check (
  (cardinality(variants) = 0 and r2_key not like '%/')
  or (cardinality(variants) > 0 and r2_key like '%/' and variant_names_ok(variants)));

-- The owner converts an older image into a folder (r2_key, variants, sizes);
-- nobody else changes them.
grant update (r2_key, variants, width, height, bytes, content_type) on gear_files to bottega_app;

-- Storage by kind, for the signed-in person. Same rules as storage_used():
-- approved library documents belong to the platform and count against nobody.
create or replace function my_usage()
returns table (kind text, files bigint, bytes bigint)
language sql stable security definer set search_path = public, pg_temp as $body$
  with me as (select app_user() as id where app_active())
  select 'audio', count(a.id), coalesce(sum(a.bytes), 0)::bigint
    from me join projects p on p.owner_id = me.id join audio a on a.project_id = p.id
  union all
  select 'gear images', count(f.id), coalesce(sum(f.bytes), 0)::bigint
    from me join gear g on g.owner_id = me.id join gear_files f on f.gear_id = g.id
    where f.content_type like 'image/%'
  union all
  select 'gear documents', count(f.id), coalesce(sum(f.bytes), 0)::bigint
    from me join gear g on g.owner_id = me.id join gear_files f on f.gear_id = g.id
    where f.content_type not like 'image/%'
  union all
  select 'private documents', count(d.id), coalesce(sum(d.bytes), 0)::bigint
    from me join documents d on d.owner_id = me.id
  union all
  select 'library submissions', count(d.id), coalesce(sum(d.bytes), 0)::bigint
    from me join documents d on d.library and d.contributed_by = me.id and d.review_status <> 'approved'
$body$;
revoke execute on function my_usage() from public;
grant execute on function my_usage() to bottega_app;

-- Bytes an account may still store: null when it has no limit (the platform
-- administrator). Uploads to a unit count against the unit's owner, whoever
-- uploads, so a collaborator's photo is checked against the owner's room.
create or replace function storage_room(p_owner text) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select case
    when not app_active() then 0
    when exists (select 1 from accounts where user_id = p_owner and is_platform_admin) then null
    else greatest((select storage_bytes from effective_limits(p_owner)) - storage_used(p_owner), 0)
  end
$body$;
revoke execute on function storage_room(text) from public;
grant execute on function storage_room(text) to bottega_app;

commit;

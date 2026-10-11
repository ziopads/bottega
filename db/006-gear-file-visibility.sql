-- 006 — Each gear file says who sees it, and how it is turned (REQUIREMENTS
-- G-7, G-9).
--
--   - public: shown to everyone the unit is shared with (and, when there is
--     one, on the owner's showcase page). A private file is the owner's alone,
--     at every share level and in the administrator's view. Until now the
--     role decided: photos followed the unit's shares, everything else was the
--     owner's. Existing rows keep exactly that: photos public, the rest
--     private.
--   - rotation: 0, 90, 180 or 270 degrees clockwise, applied when the image
--     is shown. The stored file is never rewritten, so a turn costs nothing
--     and can always be undone.
--
-- A contributor's photo must be public, or they could not see what they
-- added. Only the owner changes a file afterwards (the update policy in 003).
--
-- Requires 003. Safe to run twice.

begin;

do $body$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'gear_files' and column_name = 'public') then
    alter table gear_files add column public boolean not null default false;
    update gear_files set public = (role = 'photo');
  end if;
end
$body$;

alter table gear_files add column if not exists rotation smallint not null default 0;
alter table gear_files drop constraint if exists gear_files_rotation;
alter table gear_files add constraint gear_files_rotation check (rotation in (0, 90, 180, 270));

drop policy if exists gear_files_read on gear_files;
create policy gear_files_read on gear_files for select
  using (gear_rank(gear_id) = 4 or (public and gear_rank(gear_id) > 0));

drop policy if exists gear_files_insert on gear_files;
create policy gear_files_insert on gear_files for insert
  with check (uploaded_by_id = app_user() and not app_admin_viewing()
              and (gear_rank(gear_id) = 4 or (role = 'photo' and public and gear_rank(gear_id) >= 2)));

grant update (public, rotation) on gear_files to bottega_app;

commit;

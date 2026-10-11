-- 014 — Session snapshots: what each saved Live set holds (REQUIREMENTS A-6
-- to A-8, S-15).
--
--   - als_snapshots: one row per saved .als file of a session, read by the
--     parser in lib/als (in the browser when a project folder is dropped on
--     the session page; later by a program on the Mac, A-9). data is the
--     parser's whole description (lib/als/types.ts AlsSet): tracks, zones,
--     devices and plugins, where clips play, samples and where they live,
--     tempo, length and locators. A file is identified by the SHA-256 of its
--     contents, so dropping the folder again adds only new saves; a save read
--     by an older parser_version is read again and replaced.
--   - project_folders: the files of the session's project folder as last
--     read, by path and size (no audio is uploaded), so the State tab can
--     name files the set expects but the folder lacks, and files no saved set
--     uses.
--   - als_plugins: plugin instances per snapshot, kept by a trigger from
--     data, for questions across sessions ("which sessions use EchoBoy?").
--
-- Anyone who can see the session reads these; edit access writes them; only
-- the owner deletes.
--
-- Requires 002. Safe to run twice.

begin;

create table if not exists als_snapshots (
  id                bigint generated always as identity primary key,
  project_id        bigint not null references projects(id) on delete cascade,
  file_name         text not null check (file_name <> '' and char_length(file_name) <= 255),
  saved_at          timestamptz not null,
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes             bigint not null check (bytes > 0),
  live_version      text not null default '',
  parser_version    int not null check (parser_version > 0),
  tempo             real,
  length_beats      real not null default 0,
  tracks            int not null default 0,
  plugins           int not null default 0,
  external_samples  int not null default 0,
  data              jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 4000000),
  created_by        text not null default app_user() references accounts(user_id),
  created_at        timestamptz not null default now(),
  unique (project_id, sha256)
);
create index if not exists als_snapshots_project_idx on als_snapshots (project_id, saved_at);

create table if not exists project_folders (
  project_id   bigint primary key references projects(id) on delete cascade,
  folder_name  text not null default '',
  files        jsonb not null check (jsonb_typeof(files) = 'array' and octet_length(files::text) < 4000000),
  file_count   int not null default 0,
  total_bytes  bigint not null default 0,
  scanned_by   text not null default app_user() references accounts(user_id),
  scanned_at   timestamptz not null default now()
);

create table if not exists als_plugins (
  snapshot_id  bigint not null references als_snapshots(id) on delete cascade,
  project_id   bigint not null references projects(id) on delete cascade,
  name         text not null,
  format       text not null default '',
  instances    int not null,
  active       int not null,
  primary key (snapshot_id, name, format)
);
create index if not exists als_plugins_name_idx on als_plugins (lower(name));

-- The summary columns and the plugin table follow data, whoever writes it.
create or replace function als_snapshots_derive() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  new.live_version := coalesce(new.data->>'live', '');
  new.tempo := nullif(new.data->>'tempo', '')::real;
  new.length_beats := coalesce((new.data->>'lengthBeats')::real, 0);
  new.tracks := coalesce(jsonb_array_length(new.data->'tracks'), 0);
  new.external_samples := (select count(*) from jsonb_array_elements(coalesce(new.data->'samples', '[]')) s where s->>'where' = 'external');
  new.plugins := (select count(*) from jsonb_array_elements(coalesce(new.data->'tracks', '[]')) t,
                         jsonb_array_elements(coalesce(t->'devices', '[]')) d where d->>'kind' = 'plugin');
  return new;
end;
$body$;
drop trigger if exists als_snapshots_derive on als_snapshots;
create trigger als_snapshots_derive before insert or update on als_snapshots
  for each row execute function als_snapshots_derive();

create or replace function als_snapshots_plugins() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  delete from als_plugins where snapshot_id = new.id;
  insert into als_plugins (snapshot_id, project_id, name, format, instances, active)
  select new.id, new.project_id, d->>'name', coalesce(d->>'format', ''), count(*),
         count(*) filter (where coalesce((d->>'on')::boolean, true))
    from jsonb_array_elements(coalesce(new.data->'tracks', '[]')) t,
         jsonb_array_elements(coalesce(t->'devices', '[]')) d
   where d->>'kind' = 'plugin' and coalesce(d->>'name', '') <> ''
   group by d->>'name', coalesce(d->>'format', '');
  return null;
end;
$body$;
drop trigger if exists als_snapshots_plugins on als_snapshots;
create trigger als_snapshots_plugins after insert or update of data on als_snapshots
  for each row execute function als_snapshots_plugins();

alter table als_snapshots enable row level security;
alter table project_folders enable row level security;
alter table als_plugins enable row level security;

drop policy if exists als_snapshots_read on als_snapshots;
create policy als_snapshots_read on als_snapshots for select using (project_rank(project_id) > 0);
drop policy if exists als_snapshots_insert on als_snapshots;
create policy als_snapshots_insert on als_snapshots for insert
  with check (project_rank(project_id) >= 3 and created_by = app_user() and not app_admin_viewing());
drop policy if exists als_snapshots_update on als_snapshots;
create policy als_snapshots_update on als_snapshots for update
  using (project_rank(project_id) >= 3 and not app_admin_viewing())
  with check (project_rank(project_id) >= 3);
drop policy if exists als_snapshots_delete on als_snapshots;
create policy als_snapshots_delete on als_snapshots for delete using (project_rank(project_id) = 4);

drop policy if exists project_folders_read on project_folders;
create policy project_folders_read on project_folders for select using (project_rank(project_id) > 0);
drop policy if exists project_folders_insert on project_folders;
create policy project_folders_insert on project_folders for insert
  with check (project_rank(project_id) >= 3 and scanned_by = app_user() and not app_admin_viewing());
drop policy if exists project_folders_update on project_folders;
create policy project_folders_update on project_folders for update
  using (project_rank(project_id) >= 3 and not app_admin_viewing())
  with check (project_rank(project_id) >= 3 and scanned_by = app_user());

drop policy if exists als_plugins_read on als_plugins;
create policy als_plugins_read on als_plugins for select using (project_rank(project_id) > 0);

grant select on als_snapshots, project_folders, als_plugins to bottega_app;
grant insert on als_snapshots, project_folders to bottega_app;
grant update (file_name, saved_at, bytes, parser_version, data) on als_snapshots to bottega_app;
grant update (folder_name, files, file_count, total_bytes, scanned_by, scanned_at) on project_folders to bottega_app;
grant delete on als_snapshots to bottega_app;
grant usage on all sequences in schema public to bottega_app;

commit;

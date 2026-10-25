-- 033 — The Projects list's columns, chosen per person (decided 25 October
-- 2026): which columns show and in what order, kept with the account. Null
-- keeps the default, which drops the minor columns on narrow windows.
--
-- Safe to run twice.

begin;

alter table account_preferences add column if not exists project_columns text[];
alter table account_preferences drop constraint if exists account_preferences_project_columns_check;
alter table account_preferences add constraint account_preferences_project_columns_check
  check (project_columns is null or (cardinality(project_columns) between 1 and 20
         and project_columns <@ array['rating', 'artist', 'id', 'name', 'genre', 'bpm', 'versions', 'length', 'collections', 'date', 'upload', 'board']));
grant update (project_columns) on account_preferences to bottega_app;

commit;

-- 023 — A project's BPM from its newest saved Live set (decided 14 October
-- 2026).
--
--   - Whenever a save is stored, or read again by a newer parser, the
--     project's bpm becomes the tempo of its newest save (by save time, in
--     any variant). Dropping the project folder on the State tab stores each
--     save in turn, and the Mac watcher (A-9) will store them the same way;
--     whichever order they arrive in, the newest decides. A BPM typed by hand
--     lasts until the next save.
--   - A tempo outside music_projects' range (20 to 400) is left alone, and so
--     is a project whose newest save has no tempo.
--   - The trigger runs as the person storing the save, who already has edit
--     access to the project (als_snapshots_insert), so row-level security on
--     music_projects is unchanged.
--   - Once, now: every project with saves takes its newest save's tempo.
--
-- Requires 014. Safe to run twice.

begin;

create or replace function project_bpm_from_saves(p_project bigint) returns void
language sql as $body$
  update music_projects m
     set bpm = round(s.tempo::numeric, 2)
    from (select tempo from als_snapshots where project_id = p_project
           order by saved_at desc, id desc limit 1) s
   where m.project_id = p_project
     and s.tempo between 20 and 400
     and m.bpm is distinct from round(s.tempo::numeric, 2)
$body$;

create or replace function als_snapshots_bpm() returns trigger
language plpgsql as $body$
begin
  perform project_bpm_from_saves(new.project_id);
  return null;
end;
$body$;
drop trigger if exists als_snapshots_bpm on als_snapshots;
create trigger als_snapshots_bpm after insert or update of data, saved_at on als_snapshots
  for each row execute function als_snapshots_bpm();

grant execute on function project_bpm_from_saves(bigint) to bottega_app;

-- Once: the projects that already have saves.
select project_bpm_from_saves(project_id) from (select distinct project_id from als_snapshots) p;

commit;

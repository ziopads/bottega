-- 009 — Waveforms for mixes, and notes pinned to a moment (REQUIREMENTS S-10,
-- S-11).
--
--   - audio.peaks: the file's loudness outline, measured in the browser when
--     the file is uploaded (or later, from the backfill page): up to 2000
--     values from 0 to 255, each the loudest point in its stretch of the
--     file. A few kilobytes per mix; the player draws the waveform from it.
--     Filled by anyone who may contribute to the project, like duration_s.
--   - notes.position_s: where in the mix a note is about, in seconds from the
--     start. Meaningful with audio_id; when the mix is deleted the note keeps
--     its text and loses its version, so the position is then only history.
--
-- Requires 002. Safe to run twice.

begin;

create or replace function peaks_ok(p smallint[]) returns boolean
language sql immutable as $body$
  select cardinality(p) between 1 and 2000 and coalesce(bool_and(v between 0 and 255), false) from unnest(p) v
$body$;

alter table audio add column if not exists peaks smallint[];
alter table audio drop constraint if exists audio_peaks_ok;
alter table audio add constraint audio_peaks_ok check (peaks is null or peaks_ok(peaks));
grant update (peaks) on audio to bottega_app;

alter table notes add column if not exists position_s real;
alter table notes drop constraint if exists notes_position_ok;
alter table notes add constraint notes_position_ok check (position_s is null or (position_s >= 0 and position_s < 43200));
grant update (position_s) on notes to bottega_app;

commit;

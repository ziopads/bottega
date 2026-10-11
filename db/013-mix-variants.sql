-- 013 — Mix variants: a radio edit, an extended mix, an instrumental, kept
-- beside the session's main mix (REQUIREMENTS S-14).
--
--   - audio.variant: '' for the main mix, else the variant's name as typed
--     ("Radio edit", "Extended"). Versions are numbered within a variant, so
--     a session can have v1–v3 of the main mix and Radio edit v1. Set at
--     upload and not changed afterwards.
--   - The session's current mix (S-8) can be a version of any variant.
--
-- Remixes are their own sessions; a link between them comes later.
--
-- Requires 001. Safe to run twice.

begin;

alter table audio add column if not exists variant text not null default '';
alter table audio drop constraint if exists audio_variant_ok;
alter table audio add constraint audio_variant_ok
  check (variant = btrim(variant) and char_length(variant) <= 40 and lower(variant) <> 'main');

-- Versions count within a variant. References have no version and no variant.
alter table audio drop constraint if exists audio_project_id_version_key;
alter table audio drop constraint if exists audio_project_variant_version_key;
alter table audio add constraint audio_project_variant_version_key unique (project_id, variant, version);
alter table audio drop constraint if exists audio_reference_no_variant;
alter table audio add constraint audio_reference_no_variant check (role = 'mix' or variant = '');

commit;

-- 035 — The platform's default music template: a Polish stage after Detail,
-- no Release stage, Detail refined, two Mixdown criteria made one.
--
--   - Stages: Seed, Palette, Structure, Detail, Polish, Mixdown, Master.
--     Release (and its four criteria) leaves the music default, so a default
--     music project is finished when Master is complete (034). The collection
--     default keeps its own Release stage.
--   - Detail: the standard becomes "Refining and improving what's there"; the
--     existing criteria keep their identities (uids) and Other percussion moves
--     up to second; one criterion is added, on groove and note tweaks.
--   - Polish: "Add polishing effects to each track", six criteria.
--   - Mixdown: "Kick and sub relationship resolved" and "Low end mono below
--     about 120 Hz" become one criterion, and Panning pass comes before Gain
--     staged; the rest are as they were.
--
-- FROM THIS POINT FORWARD. Only the platform default changes (024 seeded it
-- only when missing, so editing 024 would change nothing on a database that
-- has it). It is what new accounts, and accounts that never chose or copied a
-- template, start new music projects from. An account with its own copy keeps
-- it. A project already started keeps its own stages and criteria, and is
-- marked as having seen this version of the default, so it is not offered
-- the changes (template_apply would bring in Detail's new criterion and
-- standard but could never add Polish or remove Release).
--
-- Written against the default as 024 seeded it: criteria are found by their
-- text, and a part that has been edited by hand since is left alone. A
-- Release stage's learnings, if any, move to Master. Does nothing when Polish
-- is already there.
--
-- Requires 028. Safe to run twice.

begin;

do $default$
declare
  t bigint;
  v_before int;
  s_detail bigint;
  s_mixdown bigint;
  s_master bigint;
  s_release bigint;
  s_polish bigint;
  detail_pos int;
  moved int;
begin
  select id, version into t, v_before from workflow_templates where owner_id is null and kind = 'music';
  if t is null or exists (select 1 from template_stages where template_id = t and key = 'polish') then
    return;
  end if;
  select id, position into s_detail, detail_pos from template_stages where template_id = t and key = 'detail';
  select id into s_mixdown from template_stages where template_id = t and key = 'mixdown';
  select id into s_master from template_stages where template_id = t and key = 'master';
  select id into s_release from template_stages where template_id = t and key = 'release';
  -- Not the default 024 made: nothing to anchor the change to.
  if s_detail is null or s_mixdown is null or s_master is null then
    return;
  end if;

  -- Release goes; what a person wrote to remember there moves to Master.
  if s_release is not null then
    update template_learnings
       set stage_id = s_master,
           position = position + (select coalesce(max(position), 0) from template_learnings where stage_id = s_master)
     where stage_id = s_release;
    delete from template_stages where id = s_release;
  end if;

  -- Polish takes the place after Detail.
  update template_stages set position = position + 1 where template_id = t and position > detail_pos;
  insert into template_stages (template_id, key, position, label, standard)
  values (t, 'polish', detail_pos + 1, 'Polish', 'Add polishing effects to each track')
  returning id into s_polish;
  insert into template_criteria (stage_id, position, body, hint) values
    (s_polish, 1, 'Bass: add grit and compression, carve out kick spectrum',
       'Sidechain off kick using 1976 compressor in Ableton, dbx 160 for compression, Fairchild 660 for drive, EQ notch on kick fundamental, Utility > Bass Mono on main below 120 Hz'),
    (s_polish, 2, 'Hats and Perc: add sparkle / reverb / grit / delay',
       'Culture Vulture or Arturia Dist Tube Culture / Empirical Labs Distressor / Fairchild 660, Kilohearts Haas for widening, EQ roll offs for low end'),
    (s_polish, 3, 'Synths and FX: determine if/where delay or modulation effects will be used',
       'Echoboy / Galaxy Tape Echo etc., Fragments / Refract / Coldfire, Techno gate, Soundtoys Crystallizer, EQ shaping, Kilohearts Haas for widening'),
    (s_polish, 4, 'Drum group tied together with glue compressor and reverb', ''),
    (s_polish, 5, 'Volume automation added', ''),
    (s_polish, 6, 'Another fresh ear listen', 'Bounce to mp3, try on different systems');

  -- Detail.
  update template_stages set standard = 'Refining and improving what''s there' where id = s_detail;
  update template_criteria set position = 2 where stage_id = s_detail and body = 'Other percussion chosen and tuned';
  update template_criteria set position = 4 where stage_id = s_detail and body = 'Transitions built';
  update template_criteria set position = 5 where stage_id = s_detail and body = 'Automation pass';
  update template_criteria set position = 6 where stage_id = s_detail and body = 'Ear candy and vocals placed';
  update template_criteria set position = 7 where stage_id = s_detail and body = 'A fresh-ears listen after a day away';
  insert into template_criteria (stage_id, position, body, hint)
  select s_detail, 3, 'Check for any tracks where groove/note tweaks are needed',
         'Revisit note start/stop, velocity variations, slight timing shifts/humanization, attack/decay/compression as tools to increase groove, swing settings, delay with swing/shuffle'
   where not exists (select 1 from template_criteria where stage_id = s_detail and body = 'Check for any tracks where groove/note tweaks are needed');

  -- Mixdown: two criteria become one (the second goes only if the first was found),
  -- and Panning pass moves ahead of Gain staged.
  update template_criteria
     set body = 'Kick and sub relationship resolved, low end mono below 120 Hz'
   where stage_id = s_mixdown and body = 'Kick and sub relationship resolved';
  get diagnostics moved = row_count;
  if moved > 0 then
    delete from template_criteria where stage_id = s_mixdown and body = 'Low end mono below about 120 Hz';
    update template_criteria set position = 2 where stage_id = s_mixdown and body = 'Panning pass';
    update template_criteria set position = 3 where stage_id = s_mixdown and body = 'Gain staged, master left clean';
    update template_criteria tc set position = r.n
      from (select id, row_number() over (order by position, id) as n from template_criteria where stage_id = s_mixdown) r
     where tc.id = r.id and tc.position <> r.n;
  end if;

  -- Projects started from the default and up to date have seen this version.
  update project_workflow
     set template_version = (select version from workflow_templates where id = t)
   where template_id = t and template_version = v_before;
end;
$default$;

commit;

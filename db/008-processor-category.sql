-- 008 — Signal processors apart from effects (REQUIREMENTS G-11).
--
-- The catalogue's 'effect' covered both what colours or shapes a signal
-- (filters, compressors, gates, EQ, channel strips) and what adds to it in
-- time or space (reverb, delay, slicers, loopers). The gear map shows them
-- as separate groups, and which one a model belongs to is a fact about the
-- model, so it is a category: 'processor'.
--
-- Existing effect models whose effect types are all processing (filter,
-- compressor, limiter, gate, eq) become processors. A model with any other
-- effect type, or none recorded, stays an effect; the administrator can move
-- it from the catalogue page.
--
-- Requires 005. Safe to run twice.

begin;

alter table gear_models drop constraint if exists gear_models_category_check;
alter table gear_models add constraint gear_models_category_check check (category in (
  'synthesizer', 'drum machine', 'sampler', 'groovebox', 'instrument', 'sequencer',
  'effect', 'processor', 'mixer', 'interface', 'controller', 'monitor', 'microphone',
  'preamp', 'amplifier', 'recorder', 'patchbay', 'midi utility', 'utility', 'test equipment',
  'instrument plugin', 'effect plugin', 'host', 'sample library',
  'book', 'cable', 'power', 'other'));

update gear_models m set category = 'processor'
where m.category = 'effect'
  and exists (
    select 1 from model_capabilities c
    where c.model_id = m.id and c.capability = 'effect_types' and jsonb_array_length(c.value) > 0
      and not exists (
        select 1 from jsonb_array_elements_text(c.value) t
        where t not in ('filter', 'compressor', 'limiter', 'gate', 'eq')));

commit;

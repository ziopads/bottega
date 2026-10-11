import type { GearCategory, GearUnit } from '@/lib/gearTypes';

// The studio's groups (REQUIREMENTS G-11): how the gear map lays a room out.
// Each catalogue category belongs to one group, so a unit's group follows
// from its model and nobody files gear twice. A unit with no catalogue model
// goes to Misc until it has one. No server imports; client components use it.

export const GEAR_GROUPS = [
  { key: 'audio', label: 'Audio', note: 'Interfaces, monitors, headphone amps, mixers, MIDI' },
  { key: 'sound', label: 'Sound modules', note: 'Synths, drum machines, samplers' },
  { key: 'control', label: 'Controllers and sequencers', note: 'What plays the sound modules' },
  { key: 'processors', label: 'Signal processors', note: 'Filters, dynamics, EQ, preamps' },
  { key: 'effects', label: 'Effects', note: 'Reverb, delay, slicers, loopers' },
  { key: 'mics', label: 'Mics', note: '' },
  { key: 'misc', label: 'Misc', note: 'Recorders, power, patchbays, test gear' },
  { key: 'software', label: 'Software', note: 'Plugins, hosts, libraries' },
] as const;

export type GearGroup = (typeof GEAR_GROUPS)[number]['key'];

const BY_CATEGORY: Record<GearCategory, GearGroup> = {
  interface: 'audio',
  monitor: 'audio',
  amplifier: 'audio',
  mixer: 'audio',
  'midi utility': 'audio',
  synthesizer: 'sound',
  'drum machine': 'sound',
  sampler: 'sound',
  groovebox: 'sound',
  instrument: 'sound',
  controller: 'control',
  sequencer: 'control',
  processor: 'processors',
  preamp: 'processors',
  effect: 'effects',
  microphone: 'mics',
  recorder: 'misc',
  power: 'misc',
  patchbay: 'misc',
  utility: 'misc',
  'test equipment': 'misc',
  cable: 'misc',
  book: 'misc',
  other: 'misc',
  'instrument plugin': 'software',
  'effect plugin': 'software',
  host: 'software',
  'sample library': 'software',
};

export function groupOf(u: Pick<GearUnit, 'model'>): GearGroup {
  if (!u.model) return 'misc';
  if (u.model.kind === 'software') return 'software';
  return BY_CATEGORY[u.model.category] ?? 'misc';
}

export function groupLabel(g: GearGroup): string {
  return GEAR_GROUPS.find((x) => x.key === g)?.label ?? g;
}

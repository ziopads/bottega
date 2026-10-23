import { playable } from '@/lib/als/analyse';
import { NOTE_NAMES, type AlsSet } from '@/lib/als/types';
import type { CheckResult } from '@/lib/workflowTypes';

// Likely done (REQUIREMENTS W-18, db/024 workflow_checks): what the newest
// saved set of a project says about the criteria that name a check. Pure.
// Bottega never ticks a criterion; these only mark one "likely done" or
// "likely not yet", with what was read, for the person to decide.

/** What the checks read: the newest saved set of the main mix, and the project's references. */
export type CheckInput = { set: AlsSet | null; references: number };

const BAR = 4; // beats in a 4/4 bar
const bar = (beat: number) => Math.floor(beat / BAR) + 1;
const LIVE_NAME = /^(\d+[-\s])?(MIDI|Audio|Group)$/i;
const LIMITER = /limit|maximi|pro-l|ozone|elevate|\bl[123]\b|oxford/i;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Beats where a switched-on MIDI or audio track plays, merged. */
function covered(set: AlsSet): [number, number][] {
  const spans = playable(set)
    .filter((t) => t.on)
    .flatMap((t) => t.spans)
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Section starts: the locators, and the start of the arrangement when the first locator is later. */
function sections(set: AlsSet): number[] {
  const starts = set.locators.map((l) => l.beat).filter((b) => b >= 0 && b < set.lengthBeats);
  if (!starts.length || starts[0] > 0) starts.unshift(0);
  return Array.from(new Set(starts)).sort((a, b) => a - b);
}

type Check = (input: CheckInput) => CheckResult;
const NO_SET: CheckResult = { verdict: 'unknown', reading: 'no saved set read yet' };
const needSet = (f: (set: AlsSet) => CheckResult): Check => ({ set }) => (set ? f(set) : NO_SET);

export const CHECKS: Record<string, Check> = {
  tempo_key: needSet((set) => {
    const tempo = set.tempo === null ? null : `${Math.round(set.tempo * 100) / 100} BPM`;
    if (set.key === undefined) return { verdict: 'unknown', reading: `${tempo ?? 'no tempo'}; the key was not read (drop the folder again)` };
    const key = set.key ? `${NOTE_NAMES[set.key.root]} ${set.key.scale}`.trim() : null;
    if (!tempo) return { verdict: 'not yet', reading: 'no tempo' };
    if (!set.key || set.key.inKey === false) return { verdict: 'not yet', reading: `${tempo}; Scale Mode off` };
    return { verdict: 'likely', reading: `${tempo} · ${key}` };
  }),
  has_reference: ({ references }) =>
    references > 0 ? { verdict: 'likely', reading: plural(references, 'reference') } : { verdict: 'not yet', reading: 'no reference added' },
  samples_collected: needSet((set) => {
    const outside = set.samples.filter((s) => s.where === 'external').length;
    return outside === 0
      ? { verdict: 'likely', reading: 'every sample is in the project folder or a Live library' }
      : { verdict: 'not yet', reading: `${plural(outside, 'sample')} outside the project folder` };
  }),
  tracks_named: needSet((set) => {
    const tracks = set.tracks.filter((t) => t.kind !== 'main' && t.kind !== 'return');
    const groups = tracks.filter((t) => t.kind === 'group').length;
    const liveNamed = tracks.filter((t) => LIVE_NAME.test(t.name.trim())).length;
    const music = playable(set);
    const grouped = music.filter((t) => t.groupId).length;
    const reading = `${plural(tracks.length, 'track')}, ${plural(groups, 'group')}${liveNamed ? `, ${liveNamed} with Live’s names` : ''}`;
    const ok = tracks.length > 0 && liveNamed === 0 && groups > 0 && grouped * 2 >= music.length;
    return { verdict: ok ? 'likely' : 'not yet', reading };
  }),
  locators: needSet((set) => {
    const named = set.locators.filter((l) => l.name.trim() && !/^locator\s*\d*$/i.test(l.name.trim()));
    const reading = set.locators.length ? `${plural(set.locators.length, 'locator')}: ${set.locators.map((l) => l.name || '(no name)').join(' · ')}` : 'no locators';
    return { verdict: set.locators.length >= 5 && named.length === set.locators.length ? 'likely' : 'not yet', reading };
  }),
  dj_edges: needSet((set) => {
    const starts = sections(set);
    if (starts.length < 2 || set.lengthBeats <= 0) return { verdict: 'unknown', reading: 'no locators to mark the sections' };
    const first = (starts[1] - starts[0]) / BAR;
    const last = (set.lengthBeats - starts[starts.length - 1]) / BAR;
    const reading = `first section ${Math.round(first)} bars, last ${Math.round(last)} bars`;
    return { verdict: first >= 16 && last >= 16 ? 'likely' : 'not yet', reading };
  }),
  no_gaps: needSet((set) => {
    if (set.lengthBeats <= 0) return { verdict: 'not yet', reading: 'no clips in the arrangement' };
    const spans = covered(set);
    let at = 0;
    for (const [s, e] of spans) {
      if (s - at >= BAR) return { verdict: 'not yet', reading: `silent from bar ${bar(at)} to bar ${bar(s) - 1}` };
      at = Math.max(at, e);
    }
    return { verdict: 'likely', reading: `clips run ${Math.round(set.lengthBeats / BAR)} bars with no silent bar` };
  }),
  automation: needSet((set) => {
    const n = set.tracks.filter((t) => t.automation > 0).length;
    return { verdict: n >= 3 ? 'likely' : 'not yet', reading: `${plural(n, 'track')} with automation` };
  }),
  master_clean: needSet((set) => {
    const main = set.tracks.find((t) => t.kind === 'main');
    const on = (main?.devices ?? []).filter((d) => d.on && !/Rack$/.test(d.name));
    return on.length === 0
      ? { verdict: 'likely', reading: 'no device on the main track' }
      : { verdict: 'not yet', reading: `on the main track: ${on.map((d) => d.name).join(', ')}` };
  }),
  master_chain: needSet((set) => {
    const main = set.tracks.find((t) => t.kind === 'main');
    const on = (main?.devices ?? []).filter((d) => d.on);
    const lim = on.filter((d) => LIMITER.test(d.name));
    return lim.length
      ? { verdict: 'likely', reading: `on the main track: ${on.map((d) => d.name).join(', ')}` }
      : { verdict: 'not yet', reading: on.length ? `no limiter on the main track (${on.map((d) => d.name).join(', ')})` : 'nothing on the main track' };
  }),
};

/** Every check a project's criteria name, run once each. */
export function runChecks(keys: Iterable<string>, input: CheckInput): Record<string, CheckResult> {
  const out: Record<string, CheckResult> = {};
  for (const k of keys) {
    const check = CHECKS[k];
    if (check && !(k in out)) out[k] = check(input);
  }
  return out;
}

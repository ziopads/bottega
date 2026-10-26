// Sorting a set's tracks into zones (REQUIREMENTS W-27, db/025), when a set is
// read for display, by the project's structure: so a changed mapping applies
// to every set already stored. Pure; the server and the browser both use it.
//
// A track belongs to a zone when its name starts with one of the zone's
// prefixes or with the zone's name, as a word: "TAC Kick", "TAC-Kick",
// "TACTUS hats". The name is tried as it stands and without a number Live put
// at its start: "7-MIDI" on a track never named, and the track's number where
// the name had "#" ("# TAC Kick" is saved as "3 TAC Kick"). A leading "#"
// is passed over too. A group track
// also belongs to a zone when its name is one of the zone's group names
// ("Drums"). A track that matches nothing takes its group's zone, and so on up.

import type { AlsSet, AlsTrack } from './types';

export type ZoneRule = { name: string; color: string | null; prefixes: string[]; groupNames: string[] };

/** The name as it stands, and without a leading "#" or a number followed by a space, "-", "_", "." or ":". */
function namesOf(name: string): string[] {
  const n = name.trim();
  const bare = n.replace(/^(?:#+|\d+(?=[\s\-_.:]))[\s\-_.:]*/, '').trim();
  return bare && bare !== n ? [n, bare] : [n];
}

/** The name starts with the word: the whole name, or followed by something other than a letter or digit. */
function startsWithWord(name: string, word: string): boolean {
  const n = name.toLocaleUpperCase();
  const w = word.trim().toLocaleUpperCase();
  if (!w || !n.startsWith(w)) return false;
  return n.length === w.length || !/[\p{L}\p{N}]/u.test(n.charAt(w.length));
}

/** The zone a track's own name puts it in, or null. Longer prefixes win, so TACX beats TAC. */
export function zoneOfName(name: string, zones: ZoneRule[], isGroup = false): string | null {
  const names = namesOf(name);
  let best: { zone: string; len: number } | null = null;
  for (const n of names) {
    for (const z of zones) {
      for (const w of [...z.prefixes, z.name]) {
        if (startsWithWord(n, w) && (!best || w.length > best.len)) best = { zone: z.name, len: w.length };
      }
    }
  }
  if (best) return best.zone;
  if (isGroup) {
    const keys = names.map((n) => n.toLocaleLowerCase());
    const z = zones.find((x) => x.groupNames.some((g) => keys.includes(g.trim().toLocaleLowerCase())));
    if (z) return z.name;
  }
  return null;
}

/** The set with each track's zone decided by these zones; the set as stored is not changed. */
export function applyZones(set: AlsSet, zones: ZoneRule[]): AlsSet {
  const own = new Map<string, string | null>(set.tracks.map((t) => [t.id, zoneOfName(t.name, zones, t.kind === 'group')]));
  const byId = new Map(set.tracks.map((t) => [t.id, t]));
  const tracks: AlsTrack[] = set.tracks.map((t) => {
    let zone = own.get(t.id) ?? null;
    let g = t.groupId ? byId.get(t.groupId) : undefined;
    const seen = new Set<string>();
    while (!zone && g && !seen.has(g.id)) {
      seen.add(g.id);
      zone = own.get(g.id) ?? null;
      g = g.groupId ? byId.get(g.groupId) : undefined;
    }
    return t.kind === 'main' || t.kind === 'return' ? { ...t, zone: null } : { ...t, zone };
  });
  return { ...set, tracks };
}

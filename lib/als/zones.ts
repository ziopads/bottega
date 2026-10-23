// Sorting a set's tracks into zones (REQUIREMENTS W-27, db/025), when a set is
// read for display, by the project's structure: so a changed mapping applies
// to every set already stored. Pure; the server and the browser both use it.
//
// A track belongs to a zone when its name (after the number Live puts before
// an unnamed track, "7-") starts with one of the zone's prefixes or with the
// zone's name, as a word: "TAC Kick", "TAC-Kick", "TACTUS hats". A group track
// also belongs to a zone when its name is one of the zone's group names
// ("Drums"). A track that matches nothing takes its group's zone, and so on up.

import type { AlsSet, AlsTrack } from './types';

export type ZoneRule = { name: string; color: string | null; prefixes: string[]; groupNames: string[] };

const bare = (name: string) => name.replace(/^\d+-\s*/, '').trim();

/** The name starts with the word: the whole name, or followed by something other than a letter or digit. */
function startsWithWord(name: string, word: string): boolean {
  const n = name.toLocaleUpperCase();
  const w = word.trim().toLocaleUpperCase();
  if (!w || !n.startsWith(w)) return false;
  return n.length === w.length || !/[\p{L}\p{N}]/u.test(n.charAt(w.length));
}

/** The zone a track's own name puts it in, or null. Longer prefixes win, so TACX beats TAC. */
export function zoneOfName(name: string, zones: ZoneRule[], isGroup = false): string | null {
  const n = bare(name);
  let best: { zone: string; len: number } | null = null;
  for (const z of zones) {
    for (const w of [...z.prefixes, z.name]) {
      if (startsWithWord(n, w) && (!best || w.length > best.len)) best = { zone: z.name, len: w.length };
    }
  }
  if (best) return best.zone;
  if (isGroup) {
    const key = n.toLocaleLowerCase();
    const z = zones.find((x) => x.groupNames.some((g) => g.trim().toLocaleLowerCase() === key));
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

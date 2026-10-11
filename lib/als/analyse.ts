// What a set says about the session (REQUIREMENTS A-7, A-8, S-15): coverage
// by zone, maintenance findings, and the differences between two saves. Pure
// and shared by the server (which builds the State tab's data) and the
// connector.

import { ZONES, type AlsSample, type AlsSet, type AlsTrack, type FolderFile, type Zone } from './types';

const AUDIO_FILE = /\.(wav|wave|aif|aiff|mp3|flac|ogg|m4a|caf)$/i;

/** Tracks that hold music: MIDI and audio. */
export function playable(set: AlsSet): AlsTrack[] {
  return set.tracks.filter((t) => t.kind === 'midi' || t.kind === 'audio');
}

function mergeAll(spans: [number, number][]): number {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of sorted) {
    if (!cur || s > cur[1]) {
      if (cur) covered += cur[1] - cur[0];
      cur = [s, e];
    } else cur[1] = Math.max(cur[1], e);
  }
  if (cur) covered += cur[1] - cur[0];
  return covered;
}

export type ZoneCoverage = {
  zone: Zone | null;
  tracks: number;
  /** Beats where at least one of its tracks plays. */
  coveredBeats: number;
  /** Of the arrangement's length, 0–1. */
  share: number;
  clips: number;
  devices: number;
  automation: number;
};

/** One row per zone, then the tracks with no zone. Only tracks that are switched on count. */
export function coverage(set: AlsSet): ZoneCoverage[] {
  const rows: ZoneCoverage[] = [];
  const tracks = playable(set).filter((t) => t.on);
  for (const zone of [...ZONES, null] as (Zone | null)[]) {
    const ts = tracks.filter((t) => t.zone === zone);
    if (zone === null && !ts.length) continue;
    const covered = mergeAll(ts.flatMap((t) => t.spans));
    rows.push({
      zone,
      tracks: ts.length,
      coveredBeats: covered,
      share: set.lengthBeats > 0 ? Math.min(1, covered / set.lengthBeats) : 0,
      clips: ts.reduce((n, t) => n + t.clips, 0),
      devices: ts.reduce((n, t) => n + t.devices.length, 0),
      automation: ts.reduce((n, t) => n + t.automation, 0),
    });
  }
  return rows;
}

export type DeviceUse = {
  name: string;
  kind: 'plugin' | 'native';
  format?: string;
  vendor?: string;
  instances: number;
  /** Instances switched off. */
  off: number;
  tracks: string[];
};

/** Plugins and Live devices by name, most used first. Racks themselves are left out. */
export function deviceUse(set: AlsSet): DeviceUse[] {
  const map = new Map<string, DeviceUse>();
  for (const t of set.tracks) {
    for (const d of t.devices) {
      if (d.kind === 'native' && /Rack$/.test(d.name)) continue;
      const key = `${d.kind}|${d.name}|${d.format ?? ''}`;
      const u = map.get(key) ?? { name: d.name, kind: d.kind, format: d.format, vendor: d.vendor, instances: 0, off: 0, tracks: [] };
      u.instances++;
      if (!d.on) u.off++;
      if (!u.tracks.includes(t.name)) u.tracks.push(t.name);
      map.set(key, u);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.instances - a.instances || a.name.localeCompare(b.name));
}

export type Maintenance = {
  plugins: DeviceUse[];
  devices: DeviceUse[];
  /** Samples outside the project folder and outside Live's libraries: "Collect All and Save" would copy them in. */
  external: AlsSample[];
  /** Project files the set uses that are not in the folder as last read. Null when no folder has been read. */
  missing: AlsSample[] | null;
  /** Audio files under Samples/ that no saved set uses. Null when no folder has been read. */
  unused: FolderFile[] | null;
  unusedBytes: number;
  frozen: string[];
  /** Tracks switched off. */
  off: string[];
  /** MIDI and audio tracks with no clips anywhere. */
  empty: string[];
  /** Devices switched off, counted. */
  devicesOff: number;
};

/**
 * Maintenance findings for one set. usedAnywhere is every project-relative
 * path any saved set of the session uses: a file only an older save needs is
 * not reported as unused.
 */
export function maintenance(set: AlsSet, folder: FolderFile[] | null, usedAnywhere: Set<string>): Maintenance {
  const uses = deviceUse(set);
  const inFolder = folder ? new Set(folder.map((f) => f.path)) : null;
  const project = set.samples.filter((s) => s.where === 'project');
  const unused = folder
    ? folder.filter((f) => f.path.startsWith('Samples/') && AUDIO_FILE.test(f.path) && !usedAnywhere.has(f.path))
    : null;
  return {
    plugins: uses.filter((u) => u.kind === 'plugin'),
    devices: uses.filter((u) => u.kind === 'native'),
    external: set.samples.filter((s) => s.where === 'external'),
    missing: inFolder ? project.filter((s) => s.relativePath && !inFolder.has(s.relativePath)) : null,
    unused: unused ? unused.sort((a, b) => b.bytes - a.bytes) : null,
    unusedBytes: unused ? unused.reduce((n, f) => n + f.bytes, 0) : 0,
    frozen: set.tracks.filter((t) => t.frozen).map((t) => t.name),
    off: playable(set).filter((t) => !t.on).map((t) => t.name),
    empty: playable(set).filter((t) => t.clips === 0 && t.sessionClips === 0).map((t) => t.name),
    devicesOff: set.tracks.reduce((n, t) => n + t.devices.filter((d) => !d.on && !(d.kind === 'native' && /Rack$/.test(d.name))).length, 0),
  };
}

export type SetChange = {
  tracksAdded: string[];
  tracksRemoved: string[];
  tracksRenamed: { from: string; to: string }[];
  pluginsAdded: string[];
  pluginsRemoved: string[];
  clips: number;
  lengthBeats: number;
  tempo: { from: number | null; to: number | null } | null;
  /** Coverage change by zone, in beats, where it moved. */
  zones: { zone: Zone | null; from: number; to: number }[];
  samplesExternal: number;
};

const bare = (name: string) => name.replace(/^\d+[-\s]\s*/, '');

function pluginCounts(set: AlsSet): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of set.tracks) for (const d of t.devices) if (d.kind === 'plugin') m.set(d.name, (m.get(d.name) ?? 0) + 1);
  return m;
}

function times(name: string, n: number): string {
  return n > 1 ? `${name} ×${n}` : name;
}

/** What changed from one save to the next (A-8). */
export function diff(prev: AlsSet, next: AlsSet): SetChange {
  const before = new Map(prev.tracks.filter((t) => t.kind !== 'main').map((t) => [t.id, t]));
  const after = new Map(next.tracks.filter((t) => t.kind !== 'main').map((t) => [t.id, t]));
  const pa = pluginCounts(prev);
  const pb = pluginCounts(next);
  const pluginsAdded: string[] = [];
  const pluginsRemoved: string[] = [];
  for (const [name, n] of pb) if (n > (pa.get(name) ?? 0)) pluginsAdded.push(times(name, n - (pa.get(name) ?? 0)));
  for (const [name, n] of pa) if (n > (pb.get(name) ?? 0)) pluginsRemoved.push(times(name, n - (pb.get(name) ?? 0)));
  const ca = new Map(coverage(prev).map((z) => [z.zone, z.coveredBeats]));
  const cb = new Map(coverage(next).map((z) => [z.zone, z.coveredBeats]));
  const zones: SetChange['zones'] = [];
  for (const zone of [...ZONES, null] as (Zone | null)[]) {
    const from = ca.get(zone) ?? 0;
    const to = cb.get(zone) ?? 0;
    if (Math.abs(to - from) >= 1) zones.push({ zone, from, to });
  }
  const clipsOf = (s: AlsSet) => s.tracks.reduce((n, t) => n + t.clips + t.sessionClips, 0);
  return {
    tracksAdded: [...after.values()].filter((t) => !before.has(t.id)).map((t) => t.name),
    tracksRemoved: [...before.values()].filter((t) => !after.has(t.id)).map((t) => t.name),
    // Live numbers unnamed tracks ("7-Trilian"); a new number alone is not a rename.
    tracksRenamed: [...after.values()]
      .filter((t) => before.has(t.id) && bare(before.get(t.id)!.name) !== bare(t.name))
      .map((t) => ({ from: before.get(t.id)!.name, to: t.name })),
    pluginsAdded,
    pluginsRemoved,
    clips: clipsOf(next) - clipsOf(prev),
    lengthBeats: next.lengthBeats - prev.lengthBeats,
    tempo: prev.tempo !== next.tempo ? { from: prev.tempo, to: next.tempo } : null,
    zones,
    samplesExternal: next.samples.filter((s) => s.where === 'external').length - prev.samples.filter((s) => s.where === 'external').length,
  };
}

export function changed(c: SetChange): boolean {
  return (
    c.tracksAdded.length + c.tracksRemoved.length + c.tracksRenamed.length + c.pluginsAdded.length + c.pluginsRemoved.length > 0 ||
    c.clips !== 0 ||
    Math.abs(c.lengthBeats) >= 1 ||
    c.tempo !== null ||
    c.zones.length > 0 ||
    c.samplesExternal !== 0
  );
}

/** "m:ss" for a position in beats at a tempo. */
export function beatsToTime(beats: number, tempo: number | null): string {
  if (!tempo) return '';
  const s = Math.round((beats * 60) / tempo);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

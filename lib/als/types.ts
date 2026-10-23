// The structured description of one saved Live set (REQUIREMENTS A-6), as the
// parser writes it and Bottega stores it (db/014 als_snapshots.data). No
// imports, so the browser, the server and the Mac program can all use it.
//
// Times are in beats, as Live stores them; a 4/4 bar is four beats.

/**
 * Raised when the parser's output changes shape or meaning; older snapshots are read again.
 * 2 (23 October 2026): the set's key and scale.
 */
export const PARSER_VERSION = 2;

/** Pitch classes as Live numbers them, C = 0. */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Live 12 stores the scale as a number (ScaleInformation/Name Value="0"). The
 * first seven follow the order of Live's scale menu; 0 (Major) is confirmed
 * from a real set (Khione, 23 October 2026), the rest are to be confirmed.
 * Others read as "scale 12" until named here.
 */
export const SCALE_NAMES: Record<number, string> = {
  0: 'Major',
  1: 'Minor',
  2: 'Dorian',
  3: 'Mixolydian',
  4: 'Lydian',
  5: 'Phrygian',
  6: 'Locrian',
};

/** "C Major", with "(Scale Mode off)" when the set says so; null when the set has no scale. */
export function keyLabel(key: AlsSet['key']): string | null {
  if (!key) return null;
  const name = `${NOTE_NAMES[key.root] ?? ''} ${key.scale}`.trim();
  return key.inKey === false ? `${name} (Scale Mode off)` : name;
}

/** A scale's name from what the set stores: a number in Live 12, a name in older sets. */
export function scaleName(raw: string): string {
  if (!/^\d+$/.test(raw)) return raw;
  return SCALE_NAMES[Number(raw)] ?? `scale ${raw}`;
}

export const ZONES = ['TACTUS', 'BASS', 'BACKGROUND', 'LEADS', 'TEXTURE', 'VOX'] as const;
export type Zone = (typeof ZONES)[number];

/** Track-name prefixes from the Live template (docs/ableton-session-template.md). */
export const ZONE_PREFIX: Record<string, Zone> = { TAC: 'TACTUS', BAS: 'BASS', BKG: 'BACKGROUND', LDS: 'LEADS', TEX: 'TEXTURE', VOX: 'VOX' };

export type AlsDevice = {
  name: string;
  kind: 'plugin' | 'native';
  /** Plugins only. */
  format?: 'vst3' | 'vst' | 'au';
  vendor?: string;
  on: boolean;
  /** Inside a rack, rather than on the track itself. */
  inRack: boolean;
};

export type AlsTrack = {
  id: string;
  kind: 'midi' | 'audio' | 'group' | 'return' | 'main';
  name: string;
  /** The group track it sits in, by id. */
  groupId: string | null;
  /** From the name's zone prefix, or its group's. */
  zone: Zone | null;
  /** The track's activator: false when switched off. */
  on: boolean;
  frozen: boolean;
  devices: AlsDevice[];
  /** Clips in the Arrangement, disabled ones included. */
  clips: number;
  /** Filled clip slots in Session view. */
  sessionClips: number;
  /** Where the enabled Arrangement clips play, merged: [start, end] in beats. */
  spans: [number, number][];
  coveredBeats: number;
  /** Automation lanes with breakpoints. */
  automation: number;
  /** Indexes into AlsSet.samples. */
  samples: number[];
};

export type SampleWhere = 'project' | 'library' | 'external';

export type AlsSample = {
  /** As Live stored it: absolute, or empty for some project files. */
  path: string;
  /** Relative to the project for project files, to the pack for library files. */
  relativePath: string;
  where: SampleWhere;
  /** The Live pack for library files. */
  pack: string | null;
  /** The size Live recorded when it last saw the file. */
  bytes: number | null;
  /** Ids of the tracks using it. */
  tracks: string[];
};

export type AlsSet = {
  parserVersion: number;
  /** "Ableton Live 12.2.6". */
  live: string;
  tempo: number | null;
  /**
   * The set's key and scale (Live 12's Scale Mode), from LiveSet/ScaleInformation:
   * root as a pitch class (C = 0), the scale's name, and whether Scale Mode is on
   * (LiveSet/InKey; null when the set does not say). Null when the set has no
   * scale, and absent from snapshots read by parser 1.
   */
  key?: { root: number; scale: string; inKey: boolean | null } | null;
  /** The end of the last enabled Arrangement clip. */
  lengthBeats: number;
  locators: { name: string; beat: number }[];
  tracks: AlsTrack[];
  samples: AlsSample[];
};

/** One file in a dropped project folder: its path inside the folder and size. */
export type FolderFile = { path: string; bytes: number };

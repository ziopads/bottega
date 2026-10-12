import type { Scoped } from '@/lib/db';

import { changed, coverage, diff, maintenance, type Maintenance, type SetChange, type ZoneCoverage } from './analyse';
import { PARSER_VERSION, type AlsSet, type FolderFile } from './types';

// Session snapshots in the database (db/014, variants db/015): storing what the browser read
// from a dropped project folder, and building the State tab's data from them
// (REQUIREMENTS A-6 to A-8, S-15). Server only.

type Row = Record<string, unknown>;
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export type SnapshotMeta = { id: number; fileName: string; savedAt: string; sha256: string; parserVersion: number };

export async function listSnapshotMeta(db: Scoped, projectId: number): Promise<SnapshotMeta[]> {
  const rows = await db.q(
    'select id, file_name, saved_at, sha256, parser_version from als_snapshots where project_id = $1 order by saved_at, id',
    [projectId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    fileName: String(r.file_name),
    savedAt: iso(r.saved_at),
    sha256: String(r.sha256),
    parserVersion: Number(r.parser_version),
  }));
}

/** A light check that a posted set is the parser's shape; the database caps its size. */
export function looksLikeSet(v: unknown): v is AlsSet {
  const s = v as AlsSet;
  return (
    !!s &&
    typeof s === 'object' &&
    Number.isInteger(s.parserVersion) &&
    s.parserVersion > 0 &&
    s.parserVersion <= PARSER_VERSION &&
    typeof s.live === 'string' &&
    Array.isArray(s.tracks) &&
    Array.isArray(s.samples) &&
    Array.isArray(s.locators) &&
    typeof s.lengthBeats === 'number'
  );
}

export type SaveResult = 'stored' | 'replaced' | 'kept';

/** Stores a save, or replaces one read by an older parser; a save already read by this parser is kept. */
export async function saveSnapshot(
  db: Scoped,
  projectId: number,
  input: { fileName: string; savedAt: string; sha256: string; bytes: number; set: AlsSet },
): Promise<SaveResult> {
  const rows = await db.q(
    `insert into als_snapshots (project_id, file_name, saved_at, sha256, bytes, parser_version, data)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     on conflict (project_id, sha256) do update
       set data = excluded.data, parser_version = excluded.parser_version,
           file_name = excluded.file_name, saved_at = excluded.saved_at
     where als_snapshots.parser_version < excluded.parser_version
     returning (xmax = 0) as inserted`,
    [projectId, input.fileName, input.savedAt, input.sha256, input.bytes, input.set.parserVersion, JSON.stringify(input.set)],
  );
  if (!rows.length) return 'kept';
  return rows[0].inserted === true ? 'stored' : 'replaced';
}

export async function saveFolder(db: Scoped, projectId: number, folderName: string, files: FolderFile[]): Promise<void> {
  const total = files.reduce((n, f) => n + f.bytes, 0);
  await db.q(
    `insert into project_folders (project_id, folder_name, files, file_count, total_bytes)
     values ($1, $2, $3::jsonb, $4, $5)
     on conflict (project_id) do update
       set folder_name = excluded.folder_name, files = excluded.files, file_count = excluded.file_count,
           total_bytes = excluded.total_bytes, scanned_by = app_user(), scanned_at = now()`,
    [projectId, folderName, JSON.stringify(files), files.length, total],
  );
}

/** One save of the chosen variant, with what changed since the save it follows. */
export type SaveEntry = {
  id: number;
  fileName: string;
  savedAt: string;
  live: string;
  /** Put in its variant by a person, rather than by the name rules (db/015). */
  byHand: boolean;
  /** Null for the first save read, or when nothing the parser tracks changed. */
  change: SetChange | null;
  /**
   * The save it is compared with, when that save is in another variant: the
   * first save of a radio edit is compared with the main save made just
   * before it, from which it was most likely copied.
   */
  comparedWith: string | null;
  /** No save to compare with: the first read. */
  first: boolean;
};

export type SessionState = {
  /** The variant shown: '' is the main mix. */
  variant: string;
  /** The variant's saves, newest first. */
  saves: SaveEntry[];
  /** The save being looked at: the newest unless one was chosen. */
  selected: (SaveEntry & { set: AlsSet }) | null;
  folder: { name: string; scannedAt: string; fileCount: number; totalBytes: number } | null;
  coverage: ZoneCoverage[];
  maintenance: Maintenance | null;
  /** Saves read by an older parser, in the whole session: dropping the folder again reads them anew. */
  stale: number;
  /** Saves read in the whole session, every variant. */
  total: number;
};

/**
 * The State tab's data for one variant of a session ('' is the main mix), at
 * one of its saves (the newest when saveId is absent or not in the variant).
 */
export async function getSessionState(
  db: Scoped,
  projectId: number,
  opts: { variant?: string; saveId?: number | null } = {},
): Promise<SessionState> {
  const variant = opts.variant ?? '';
  const [snaps, folders] = await db.tx([
    {
      text: `select id, file_name, saved_at, parser_version, variant, variant_by_hand, data from als_snapshots
              where project_id = $1 order by saved_at, id`,
      params: [projectId],
    },
    {
      text: 'select folder_name, files, file_count, total_bytes, scanned_at from project_folders where project_id = $1',
      params: [projectId],
    },
  ]);
  const all = snaps.map((r: Row) => ({
    id: Number(r.id),
    fileName: String(r.file_name),
    savedAt: iso(r.saved_at),
    parserVersion: Number(r.parser_version),
    variant: String(r.variant ?? ''),
    byHand: r.variant_by_hand === true,
    set: r.data as AlsSet,
  }));
  const mine = all.filter((s) => s.variant === variant);
  const entries = mine.map((s, i) => {
    let prev = i > 0 ? mine[i - 1] : null;
    let comparedWith: string | null = null;
    if (!prev && variant !== '') {
      // A variant's first save: compare with the main save just before it.
      prev = [...all].reverse().find((x) => x.variant === '' && x.savedAt <= s.savedAt) ?? null;
      comparedWith = prev?.fileName ?? null;
    }
    const c = prev ? diff(prev.set, s.set) : null;
    const entry: SaveEntry = {
      id: s.id,
      fileName: s.fileName,
      savedAt: s.savedAt,
      live: s.set.live,
      byHand: s.byHand,
      change: c && changed(c) ? c : null,
      comparedWith,
      first: !prev,
    };
    return { entry, set: s.set };
  });
  const chosen = entries.find((e) => e.entry.id === opts.saveId) ?? entries[entries.length - 1] ?? null;
  const f = folders[0];
  const folderFiles = f ? (f.files as FolderFile[]) : null;
  // A file any save of any variant uses is not unused.
  const usedAnywhere = new Set(
    all.flatMap((s) => s.set.samples.filter((x) => x.where === 'project' && x.relativePath).map((x) => x.relativePath)),
  );
  return {
    variant,
    saves: entries.map((e) => e.entry).reverse(),
    selected: chosen ? { ...chosen.entry, set: chosen.set } : null,
    folder: f
      ? { name: String(f.folder_name), scannedAt: iso(f.scanned_at), fileCount: Number(f.file_count), totalBytes: Number(f.total_bytes) }
      : null,
    coverage: chosen ? coverage(chosen.set) : [],
    maintenance: chosen ? maintenance(chosen.set, folderFiles, usedAnywhere) : null,
    stale: all.filter((s) => s.parserVersion < PARSER_VERSION).length,
    total: all.length,
  };
}

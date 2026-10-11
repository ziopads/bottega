import type { Scoped } from '@/lib/db';

import { changed, coverage, diff, maintenance, type Maintenance, type SetChange, type ZoneCoverage } from './analyse';
import { PARSER_VERSION, type AlsSet, type FolderFile } from './types';

// Session snapshots in the database (db/014): storing what the browser read
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

export type HistoryEntry = { id: number; fileName: string; savedAt: string; live: string; change: SetChange | null };

export type SessionState = {
  /** Every save, oldest first, each with what changed since the one before. */
  history: HistoryEntry[];
  latest: { id: number; fileName: string; savedAt: string; set: AlsSet } | null;
  folder: { name: string; scannedAt: string; fileCount: number; totalBytes: number } | null;
  coverage: ZoneCoverage[];
  maintenance: Maintenance | null;
  /** Saves read by an older parser: dropping the folder again reads them anew. */
  stale: number;
};

export async function getSessionState(db: Scoped, projectId: number): Promise<SessionState> {
  const [snaps, folders] = await db.tx([
    {
      text: `select id, file_name, saved_at, parser_version, data from als_snapshots
              where project_id = $1 order by saved_at, id`,
      params: [projectId],
    },
    {
      text: 'select folder_name, files, file_count, total_bytes, scanned_at from project_folders where project_id = $1',
      params: [projectId],
    },
  ]);
  const sets = snaps.map((r: Row) => ({
    id: Number(r.id),
    fileName: String(r.file_name),
    savedAt: iso(r.saved_at),
    parserVersion: Number(r.parser_version),
    set: r.data as AlsSet,
  }));
  const history: HistoryEntry[] = sets.map((s, i) => {
    const c = i > 0 ? diff(sets[i - 1].set, s.set) : null;
    return { id: s.id, fileName: s.fileName, savedAt: s.savedAt, live: s.set.live, change: c && changed(c) ? c : null };
  });
  const f = folders[0];
  const folderFiles = f ? (f.files as FolderFile[]) : null;
  const latest = sets[sets.length - 1] ?? null;
  const usedAnywhere = new Set(
    sets.flatMap((s) => s.set.samples.filter((x) => x.where === 'project' && x.relativePath).map((x) => x.relativePath)),
  );
  return {
    history: history.reverse(),
    latest: latest ? { id: latest.id, fileName: latest.fileName, savedAt: latest.savedAt, set: latest.set } : null,
    folder: f
      ? { name: String(f.folder_name), scannedAt: iso(f.scanned_at), fileCount: Number(f.file_count), totalBytes: Number(f.total_bytes) }
      : null,
    coverage: latest ? coverage(latest.set) : [],
    maintenance: latest ? maintenance(latest.set, folderFiles, usedAnywhere) : null,
    stale: sets.filter((s) => s.parserVersion < PARSER_VERSION).length,
  };
}

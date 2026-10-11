import type { Scoped, Statement } from '@/lib/db';
import { accountNames as names, nameOf } from '@/lib/names';
import type {
  AccessLevel,
  LatestTrack,
  ReleaseKind,
  StudioArtist,
  StudioName,
  StudioNote,
  StudioProject,
  StudioReference,
  StudioRelease,
  StudioShare,
  ShareLevel,
  StudioTrack,
} from '@/lib/studioTypes';

// Server-only studio data layer, ported from Vivarium's lib/studio.ts.
//
// Every function takes a Scoped handle (lib/db.ts) as its first argument and
// runs its SQL as that person, so row-level security (db/002) decides what
// each statement can see and change. Handles come from lib/access.ts
// (requireAccount, apiAccount) or, from Phase 1, the connector. The routes
// check levels first so a refusal reads clearly; the database refuses anyway.
//
// What changed underneath from Vivarium:
//
//   studio_projects        projects (kind 'music') + music_projects
//   working_name           projects.title
//   studio_tracks          audio, role 'mix'
//   studio_notes.track_id  notes.audio_id
//   studio_releases        projects (kind 'collection') + collections
//   studio_release_tracks  project_parts whose parent is a collection
//
// Ids are bigint, which the Neon driver returns as strings, and timestamps
// arrive as Date objects; every row passes through num() and iso() so the
// components receive the numbers and ISO strings they were written for.

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// Postgres error codes the routes turn into readable answers.
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

function pgError(err: unknown): { code?: string; constraint?: string; message: string } {
  const e = err as { code?: string; constraint?: string; message?: string };
  return { code: e?.code, constraint: e?.constraint, message: e?.message ?? '' };
}

/** Raised by db/002's credit_artist_check: an artist of another account. */
function isForeignArtist(err: unknown): boolean {
  return /belongs to another account than project/.test(pgError(err).message);
}

// ── Artists ──────────────────────────────────────────────────────────────────

/** The viewer's own artists and any artist credited on a project they can see. Own first. */
export async function listArtists(db: Scoped): Promise<StudioArtist[]> {
  const rows = await db.q(
    `select id, code, name, coalesce(account_id = app_user(), false) as mine
     from artists order by mine desc, code`,
  );
  return rows.map((r) => ({ id: num(r.id), code: String(r.code), name: String(r.name), mine: r.mine === true }));
}

// ── Projects ─────────────────────────────────────────────────────────────────

// Repeats in SQL what row-level security already enforces, so these lists stay
// right even on a connection that bypasses it (the owner role, before cutover
// step 5 in ARCHITECTURE §11).
const VISIBLE = 'project_level(p.id) is not null';

const PROJECT_SELECT = `
  select p.id, m.canonical_id, p.title, p.rating, m.genre, m.bpm, p.created_by, p.created_at,
         p.owner_id, project_level(p.id) as level,
         m.current_mix_id, a.id as artist_id, a.code as artist_code, a.name as artist_name
  from projects p
  join music_projects m on m.project_id = p.id
  join artists a on a.id = m.artist_id`;

function toProject(r: Row, owners: Map<string, string>): StudioProject {
  return {
    id: num(r.id),
    artist: { id: num(r.artist_id), code: String(r.artist_code), name: String(r.artist_name) },
    canonicalId: String(r.canonical_id),
    workingName: String(r.title ?? ''),
    rating: num(r.rating),
    genre: r.genre === null || r.genre === undefined ? '' : String(r.genre),
    bpm: numOrNull(r.bpm),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at),
    ownerId: String(r.owner_id ?? ''),
    ownerName: nameOf(owners, strOrNull(r.owner_id)),
    level: (r.level ?? 'view') as AccessLevel,
    currentMixId: numOrNull(r.current_mix_id),
  };
}

async function toProjects(db: Scoped, rows: Row[]): Promise<StudioProject[]> {
  const owners = await names(db, rows.map((r) => strOrNull(r.owner_id)));
  return rows.map((r) => toProject(r, owners));
}

/**
 * Every music project the viewer can see: their own and those shared with
 * them. Highest rated first, then newest, each with its current mix. The page
 * puts the viewer's own first (REQUIREMENTS AC-8).
 */
export async function listProjects(db: Scoped): Promise<StudioProject[]> {
  const [rows, mixes, releases] = await Promise.all([
    db.q(`${PROJECT_SELECT} where ${VISIBLE} order by p.rating desc, p.created_at desc`),
    db.q(`select id, project_id, version, duration_s, uploaded_at
       from audio where role = 'mix' order by version desc`),
    releaseMembership(db),
  ]);
  const projects = await toProjects(db, rows);

  // projectId → every mix, newest version first.
  const byProject = new Map<number, Row[]>();
  for (const m of mixes) {
    const pid = num(m.project_id);
    byProject.set(pid, [...(byProject.get(pid) ?? []), m]);
  }

  return projects.map((p) => {
    const list = byProject.get(p.id) ?? [];
    // The current mix is the one chosen by hand, else the newest.
    const current = list.find((m) => num(m.id) === p.currentMixId) ?? list[0];
    const latest: LatestTrack | null = current
      ? {
          trackId: num(current.id),
          version: num(current.version),
          durationS: numOrNull(current.duration_s),
          uploadedAt: iso(current.uploaded_at),
          count: list.length,
        }
      : null;
    return { ...p, latest, releaseIds: releases.get(p.id) ?? [] };
  });
}

export async function getProject(db: Scoped, id: number): Promise<StudioProject | null> {
  const rows = await db.q(`${PROJECT_SELECT} where p.id = $1 and ${VISIBLE}`, [id]);
  return rows.length ? (await toProjects(db, rows))[0] : null;
}

/**
 * The first of `base`, `base`b, `base`c … that this artist has not used. An
 * exact-match list, never LIKE: a canonical ID may contain % or _.
 */
export async function suggestCanonicalId(db: Scoped, artistId: number, base: string): Promise<string | null> {
  const candidates = [base, ...'bcdefghijklmnopqrstuvwxyz'.split('').map((c) => `${base}${c}`)];
  const rows = await db.q(
    'select canonical_id from music_projects where artist_id = $1 and canonical_id = any($2)',
    [artistId, candidates],
  );
  const taken = new Set(rows.map((r) => String(r.canonical_id)));
  return candidates.find((c) => !taken.has(c)) ?? null;
}

async function recordName(db: Scoped, projectId: number, name: string, by: string): Promise<void> {
  if (!name) return;
  try {
    await db.q('insert into project_titles (project_id, title, set_by) values ($1, $2, $3)', [projectId, name, by]);
  } catch (err) {
    // History is secondary to the rename itself, which has already succeeded.
    console.error('project_titles insert failed', err);
  }
}

export type CreateResult =
  | { ok: true; project: StudioProject }
  | { ok: false; reason: 'taken'; suggestion: string | null }
  | { ok: false; reason: 'no-artist' };

/**
 * One statement writes both rows, so a refused canonical ID leaves no orphan
 * project. The id comes from the projects insert, not the music_projects one:
 * under row-level security, RETURNING from music_projects would be checked
 * against a policy that cannot yet see the project inserted beside it.
 */
export async function createProject(db: Scoped, input: {
  artistId: number;
  canonicalId: string;
  workingName: string;
  by: string;
}): Promise<CreateResult> {
  let id: number;
  try {
    const rows = await db.q(
      `with p as (
         insert into projects (kind, title, created_by) values ('music', $1, $2) returning id
       ), m as (
         insert into music_projects (project_id, artist_id, canonical_id)
         select id, $3, $4 from p
       )
       select id from p`,
      [input.workingName, input.by, input.artistId, input.canonicalId],
    );
    id = num(rows[0].id);
  } catch (err) {
    const e = pgError(err);
    if (e.code === UNIQUE_VIOLATION) {
      return { ok: false, reason: 'taken', suggestion: await suggestCanonicalId(db, input.artistId, input.canonicalId) };
    }
    if (e.code === FOREIGN_KEY_VIOLATION || isForeignArtist(err)) return { ok: false, reason: 'no-artist' };
    throw err;
  }
  await recordName(db, id, input.workingName, input.by);
  const project = await getProject(db, id);
  if (!project) throw new Error(`project ${id} vanished after insert`);
  return { ok: true, project };
}

type ProjectPatch = {
  workingName?: string;
  rating?: number;
  genre?: string;
  bpm?: number | null;
  artistId?: number;
  /** null: the newest mix is current. */
  currentMixId?: number | null;
};

/**
 * The statements for one patch: projects carries title and rating,
 * music_projects carries genre, BPM and artist. Run together in one
 * transaction, so a refused move changes nothing.
 */
function patchQueries(ids: number[], patch: ProjectPatch): Statement[] {
  const queries: Statement[] = [];

  const pSet: string[] = [];
  const pParams: unknown[] = [];
  if (patch.workingName !== undefined) pSet.push(`title = $${pParams.push(patch.workingName)}`);
  if (patch.rating !== undefined) pSet.push(`rating = $${pParams.push(patch.rating)}`);
  if (pSet.length) {
    queries.push({ text: `update projects set ${pSet.join(', ')} where id = any($${pParams.push(ids)})`, params: pParams });
  }

  const mSet: string[] = [];
  const mParams: unknown[] = [];
  // '' in the app is NULL in the table: the genre foreign key accepts NULL, not ''.
  if (patch.genre !== undefined) mSet.push(`genre = $${mParams.push(patch.genre || null)}`);
  if (patch.bpm !== undefined) mSet.push(`bpm = $${mParams.push(patch.bpm)}`);
  if (patch.artistId !== undefined) mSet.push(`artist_id = $${mParams.push(patch.artistId)}`);
  if (patch.currentMixId !== undefined) mSet.push(`current_mix_id = $${mParams.push(patch.currentMixId)}`);
  if (mSet.length) {
    queries.push({
      text: `update music_projects set ${mSet.join(', ')} where project_id = any($${mParams.push(ids)})`,
      params: mParams,
    });
  }
  return queries;
}

function patchFailure(err: unknown): 'taken' | 'no-artist' | 'no-genre' | 'bad-mix' | null {
  const e = pgError(err);
  // Raised by the music_projects_current_mix_check trigger (db/001).
  if (/is not a mix of project/.test(e.message)) return 'bad-mix';
  if (isForeignArtist(err)) return 'no-artist';
  if (e.code === UNIQUE_VIOLATION) return 'taken';
  if (e.code === FOREIGN_KEY_VIOLATION) return /genre/.test(`${e.constraint} ${e.message}`) ? 'no-genre' : 'no-artist';
  return null;
}

/**
 * The same change to many sessions at once: genre, BPM, rating, artist. All of
 * them or none. Working names are not bulk-editable: each rename belongs in its
 * session's name history.
 */
export async function bulkUpdateProjects(
  db: Scoped,
  ids: number[],
  patch: { genre?: string; bpm?: number | null; rating?: number; artistId?: number },
): Promise<{ ok: true; projects: StudioProject[] } | { ok: false; reason: 'taken' | 'no-artist' | 'no-genre' }> {
  const queries = patchQueries(ids, patch);
  if (!ids.length || !queries.length) return { ok: true, projects: [] };
  try {
    await db.tx(queries);
  } catch (err) {
    const reason = patchFailure(err);
    if (reason && reason !== 'bad-mix') return { ok: false, reason };
    throw err;
  }
  const rows = await db.q(`${PROJECT_SELECT} where p.id = any($1) and ${VISIBLE}`, [ids]);
  return { ok: true, projects: await toProjects(db, rows) };
}

export type UpdateResult =
  | { ok: true; project: StudioProject }
  | { ok: false; reason: 'not-found' | 'taken' | 'no-artist' | 'no-genre' | 'bad-mix' };

/**
 * Rename, rate, set genre or BPM, move to another artist, or choose the current
 * mix. Never the canonical ID.
 */
export async function updateProject(db: Scoped, id: number, patch: ProjectPatch, by: string): Promise<UpdateResult> {
  const current = await getProject(db, id);
  if (!current) return { ok: false, reason: 'not-found' };

  const changed: ProjectPatch = {};
  if (patch.workingName !== undefined && patch.workingName !== current.workingName) changed.workingName = patch.workingName;
  if (patch.rating !== undefined && patch.rating !== current.rating) changed.rating = patch.rating;
  if (patch.genre !== undefined && patch.genre !== current.genre) changed.genre = patch.genre;
  if (patch.bpm !== undefined && patch.bpm !== current.bpm) changed.bpm = patch.bpm;
  if (patch.artistId !== undefined && patch.artistId !== current.artist.id) changed.artistId = patch.artistId;
  if (patch.currentMixId !== undefined && patch.currentMixId !== current.currentMixId) changed.currentMixId = patch.currentMixId;
  const queries = patchQueries([id], changed);
  if (!queries.length) return { ok: true, project: current };

  try {
    await db.tx(queries);
  } catch (err) {
    const reason = patchFailure(err);
    if (reason) return { ok: false, reason };
    throw err;
  }
  const project = await getProject(db, id);
  if (!project) return { ok: false, reason: 'not-found' };
  if (changed.workingName !== undefined) await recordName(db, id, project.workingName, by);
  return { ok: true, project };
}

// ── Name history ─────────────────────────────────────────────────────────────

export async function listNames(db: Scoped, projectId: number): Promise<StudioName[]> {
  const rows = await db.q(
    'select title, set_by_id, set_at from project_titles where project_id = $1 order by set_at desc, id desc',
    [projectId],
  );
  const who = await names(db, rows.map((r) => strOrNull(r.set_by_id)));
  return rows.map((r) => ({
    name: String(r.title),
    setByName: nameOf(who, strOrNull(r.set_by_id)),
    setAt: iso(r.set_at),
  }));
}

// ── Mixes ────────────────────────────────────────────────────────────────────

const TRACK_SELECT = `
  select id, project_id, version, r2_key, original_filename, bytes, duration_s, uploaded_by_id, uploaded_at
  from audio`;

function toTrack(r: Row, who: Map<string, string>): StudioTrack {
  return {
    id: num(r.id),
    projectId: num(r.project_id),
    version: num(r.version),
    originalFilename: String(r.original_filename),
    bytes: numOrNull(r.bytes),
    durationS: numOrNull(r.duration_s),
    uploadedById: strOrNull(r.uploaded_by_id),
    uploadedByName: nameOf(who, strOrNull(r.uploaded_by_id)),
    uploadedAt: iso(r.uploaded_at),
  };
}

async function uploaders(db: Scoped, rows: Row[]): Promise<Map<string, string>> {
  return names(db, rows.map((r) => strOrNull(r.uploaded_by_id)));
}

/** Newest version first. */
export async function listTracks(db: Scoped, projectId: number): Promise<StudioTrack[]> {
  const rows = await db.q(`${TRACK_SELECT} where project_id = $1 and role = 'mix' order by version desc`, [projectId]);
  const who = await uploaders(db, rows);
  return rows.map((r) => toTrack(r, who));
}

/** A mix with its storage key, for the routes that sign links. Never sent to the browser. */
export async function getTrackWithKey(db: Scoped, id: number): Promise<{ track: StudioTrack; key: string } | null> {
  const rows = await db.q(`${TRACK_SELECT} where id = $1 and role = 'mix'`, [id]);
  if (!rows.length) return null;
  return { track: toTrack(rows[0], await uploaders(db, rows)), key: String(rows[0].r2_key) };
}

/**
 * Record an uploaded MP3 as the project's next version, numbered in the same
 * statement. Two uploads finishing at once can still pick the same number; the
 * unique (project_id, version) constraint refuses the second, which retries.
 */
export async function addTrack(db: Scoped, input: {
  projectId: number;
  key: string;
  originalFilename: string;
  bytes: number;
  durationS: number | null;
  by: string;
}): Promise<StudioTrack> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = await db.q(
        `insert into audio (project_id, role, version, r2_key, original_filename, bytes, duration_s, uploaded_by)
         select $1, 'mix', coalesce(max(version), 0) + 1, $2, $3, $4, $5, $6
         from audio where project_id = $1 and role = 'mix'
         returning id, project_id, version, r2_key, original_filename, bytes, duration_s, uploaded_by_id, uploaded_at`,
        [input.projectId, input.key, input.originalFilename, input.bytes, input.durationS, input.by],
      );
      return toTrack(rows[0], await uploaders(db, rows));
    } catch (err) {
      const e = pgError(err);
      // On (project_id, version): someone else took this number. On r2_key:
      // this upload was already recorded, which is a bug, so it is not retried.
      if (e.code !== UNIQUE_VIOLATION || /r2_key/.test(`${e.constraint} ${e.message}`)) throw err;
    }
  }
  throw new Error('Could not assign a version number after several attempts.');
}

export async function deleteTrackRow(db: Scoped, id: number): Promise<void> {
  await db.q(`delete from audio where id = $1 and role = 'mix'`, [id]);
}

/** Any audio row (mix or reference) with its storage key, for the playback route. */
export async function getAudioWithKey(
  db: Scoped,
  id: number,
): Promise<{ role: 'mix' | 'reference'; projectId: number; version: number | null; credit: string; originalFilename: string; key: string } | null> {
  const rows = await db.q('select role, project_id, version, credit, original_filename, r2_key from audio where id = $1', [id]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    role: r.role === 'reference' ? 'reference' : 'mix',
    projectId: num(r.project_id),
    version: numOrNull(r.version),
    credit: String(r.credit ?? ''),
    originalFilename: String(r.original_filename),
    key: String(r.r2_key),
  };
}

// ── Lengths ──────────────────────────────────────────────────────────────────

/**
 * Record a file's length, read by a browser from the audio's own metadata,
 * the same way uploads measure it. Only fills a missing length: a length that
 * is already stored is never overwritten from here.
 */
export async function fillDuration(db: Scoped, id: number, durationS: number): Promise<boolean> {
  const rows = await db.q('update audio set duration_s = $2 where id = $1 and duration_s is null returning id', [id, durationS]);
  return rows.length > 0;
}

/** Every audio row in the viewer's own projects still missing its length, for the backfill page. */
export async function missingDurations(db: Scoped): Promise<{ id: number; label: string }[]> {
  const rows = await db.q(
    `select a.id, a.role, a.version, a.credit, m.canonical_id, ar.code
     from audio a
     left join music_projects m on m.project_id = a.project_id
     left join artists ar on ar.id = m.artist_id
     where a.duration_s is null and project_level(a.project_id) = 'owner'
     order by a.id`,
  );
  return rows.map((r) => ({
    id: num(r.id),
    label:
      r.role === 'mix'
        ? `${r.code ?? ''} ${r.canonical_id ?? ''} v${r.version}`.trim()
        : `reference: ${String(r.credit || 'uncredited')}`,
  }));
}

// ── References (other artists' tracks) ───────────────────────────────────────

function toReference(r: Row, who: Map<string, string>): StudioReference {
  return {
    id: num(r.id),
    projectId: num(r.project_id),
    credit: String(r.credit ?? ''),
    originalFilename: String(r.original_filename),
    bytes: numOrNull(r.bytes),
    durationS: numOrNull(r.duration_s),
    uploadedById: strOrNull(r.uploaded_by_id),
    uploadedByName: nameOf(who, strOrNull(r.uploaded_by_id)),
    uploadedAt: iso(r.uploaded_at),
  };
}

/** Oldest first: references are a set to compare against, not a history. */
export async function listReferences(db: Scoped, projectId: number): Promise<StudioReference[]> {
  const rows = await db.q(
    `select id, project_id, credit, original_filename, bytes, duration_s, uploaded_by_id, uploaded_at
     from audio where project_id = $1 and role = 'reference' order by uploaded_at, id`,
    [projectId],
  );
  const who = await uploaders(db, rows);
  return rows.map((r) => toReference(r, who));
}

export async function addReference(db: Scoped, input: {
  projectId: number;
  key: string;
  originalFilename: string;
  bytes: number;
  durationS: number | null;
  credit: string;
  by: string;
}): Promise<StudioReference> {
  const rows = await db.q(
    `insert into audio (project_id, role, r2_key, original_filename, bytes, duration_s, credit, uploaded_by)
     values ($1, 'reference', $2, $3, $4, $5, $6, $7)
     returning id, project_id, credit, original_filename, bytes, duration_s, uploaded_by_id, uploaded_at`,
    [input.projectId, input.key, input.originalFilename, input.bytes, input.durationS, input.credit, input.by],
  );
  return toReference(rows[0], await uploaders(db, rows));
}

export async function getReferenceWithKey(db: Scoped, id: number): Promise<{ reference: StudioReference; key: string } | null> {
  const rows = await db.q(
    `select id, project_id, credit, original_filename, bytes, duration_s, uploaded_by_id, uploaded_at, r2_key
     from audio where id = $1 and role = 'reference'`,
    [id],
  );
  if (!rows.length) return null;
  return { reference: toReference(rows[0], await uploaders(db, rows)), key: String(rows[0].r2_key) };
}

export async function updateReferenceCredit(db: Scoped, id: number, credit: string): Promise<StudioReference | null> {
  await db.q(`update audio set credit = $2 where id = $1 and role = 'reference'`, [id, credit]);
  return (await getReferenceWithKey(db, id))?.reference ?? null;
}

export async function deleteReferenceRow(db: Scoped, id: number): Promise<void> {
  await db.q(`delete from audio where id = $1 and role = 'reference'`, [id]);
}

// ── Genres ───────────────────────────────────────────────────────────────────

export async function listGenres(db: Scoped): Promise<string[]> {
  const rows = await db.q('select name from genres order by name');
  return rows.map((r) => String(r.name));
}

/** Add a genre, or return the existing spelling when one matches ignoring case. */
export async function addGenre(db: Scoped, name: string): Promise<string> {
  const find = async () => (await listGenres(db)).find((g) => g.toLowerCase() === name.toLowerCase());
  const existing = await find();
  if (existing) return existing;
  try {
    await db.q('insert into genres (name) values ($1)', [name]);
  } catch (err) {
    if (pgError(err).code === UNIQUE_VIOLATION) {
      const again = await find();
      if (again) return again;
    }
    throw err;
  }
  return name;
}

// ── Notes ────────────────────────────────────────────────────────────────────

// Assistant proposals (Phase 1) are not shown here until accepted.
const NOTE_SELECT = `
  select n.id, n.project_id, n.audio_id, n.author_id, n.body, n.created_at, n.edited_at, a.version
  from notes n left join audio a on a.id = n.audio_id`;

function toNote(r: Row, who: Map<string, string>): StudioNote {
  return {
    id: num(r.id),
    projectId: num(r.project_id),
    trackId: numOrNull(r.audio_id),
    trackVersion: numOrNull(r.version),
    authorId: strOrNull(r.author_id),
    authorName: nameOf(who, strOrNull(r.author_id)),
    body: String(r.body),
    createdAt: iso(r.created_at),
    editedAt: isoOrNull(r.edited_at),
  };
}

/** Newest first. Filtering by person, date and version happens on the page. */
export async function listNotes(db: Scoped, projectId: number): Promise<StudioNote[]> {
  const rows = await db.q(
    `${NOTE_SELECT} where n.project_id = $1 and n.reviewed and n.rejected_at is null
     order by n.created_at desc`,
    [projectId],
  );
  const who = await names(db, rows.map((r) => strOrNull(r.author_id)));
  return rows.map((r) => toNote(r, who));
}

export async function getNote(db: Scoped, id: number): Promise<StudioNote | null> {
  const rows = await db.q(`${NOTE_SELECT} where n.id = $1`, [id]);
  if (!rows.length) return null;
  return toNote(rows[0], await names(db, [strOrNull(rows[0].author_id)]));
}

/** Does this mix belong to this project? Guards a note from pointing across projects. */
async function trackInProject(db: Scoped, trackId: number, projectId: number): Promise<boolean> {
  const rows = await db.q('select 1 from audio where id = $1 and project_id = $2', [trackId, projectId]);
  return rows.length > 0;
}

export type NoteResult = { ok: true; note: StudioNote } | { ok: false; reason: 'bad-track' | 'not-found' };

export async function addNote(db: Scoped, input: {
  projectId: number;
  trackId: number | null;
  body: string;
  by: string;
}): Promise<NoteResult> {
  if (input.trackId !== null && !(await trackInProject(db, input.trackId, input.projectId))) {
    return { ok: false, reason: 'bad-track' };
  }
  const rows = await db.q(
    'insert into notes (project_id, audio_id, author, body) values ($1, $2, $3, $4) returning id',
    [input.projectId, input.trackId, input.by, input.body],
  );
  const note = await getNote(db, num(rows[0].id));
  if (!note) throw new Error('note vanished after insert');
  return { ok: true, note };
}

/** Edit the text or the version a note is about. The route decides who may. */
export async function updateNote(db: Scoped, id: number, patch: { body?: string; trackId?: number | null }): Promise<NoteResult> {
  const current = await getNote(db, id);
  if (!current) return { ok: false, reason: 'not-found' };
  if (patch.trackId !== undefined && patch.trackId !== null && !(await trackInProject(db, patch.trackId, current.projectId))) {
    return { ok: false, reason: 'bad-track' };
  }
  const set: string[] = [];
  const params: unknown[] = [];
  if (patch.body !== undefined && patch.body !== current.body) {
    set.push(`body = $${params.push(patch.body)}`);
    // Only a change to the text counts as an edit worth showing.
    set.push('edited_at = now()');
  }
  if (patch.trackId !== undefined && patch.trackId !== current.trackId) set.push(`audio_id = $${params.push(patch.trackId)}`);
  if (!set.length) return { ok: true, note: current };
  await db.q(`update notes set ${set.join(', ')} where id = $${params.push(id)}`, params);
  const note = await getNote(db, id);
  return note ? { ok: true, note } : { ok: false, reason: 'not-found' };
}

export async function deleteNote(db: Scoped, id: number): Promise<void> {
  await db.q('delete from notes where id = $1', [id]);
}

// ── Collections (Vivarium's releases) ────────────────────────────────────────

/** projectId → the ids of the collections it is part of. */
async function releaseMembership(db: Scoped): Promise<Map<number, number[]>> {
  const rows = await db.q(`select pp.parent_id, pp.child_id
                        from project_parts pp join collections c on c.project_id = pp.parent_id
                        where project_level(pp.parent_id) is not null`);
  const map = new Map<number, number[]>();
  for (const r of rows) {
    const pid = num(r.child_id);
    map.set(pid, [...(map.get(pid) ?? []), num(r.parent_id)]);
  }
  return map;
}

const RELEASE_SELECT = `
  select p.id, p.title, c.form, c.year, c.notes, p.created_at,
         p.owner_id, project_level(p.id) as level,
         a.id as artist_id, a.code as artist_code, a.name as artist_name,
         (select count(*) from project_parts pp where pp.parent_id = p.id) as track_count
  from projects p
  join collections c on c.project_id = p.id
  left join artists a on a.id = c.artist_id`;

function toRelease(r: Row, owners: Map<string, string>): StudioRelease {
  return {
    id: num(r.id),
    title: String(r.title),
    kind: String(r.form) as ReleaseKind,
    artist: r.artist_id === null ? null : { id: num(r.artist_id), code: String(r.artist_code), name: String(r.artist_name) },
    year: numOrNull(r.year),
    notes: String(r.notes ?? ''),
    createdAt: iso(r.created_at),
    trackCount: num(r.track_count),
    ownerId: String(r.owner_id ?? ''),
    ownerName: nameOf(owners, strOrNull(r.owner_id)),
    level: (r.level ?? 'view') as AccessLevel,
  };
}

async function toReleases(db: Scoped, rows: Row[]): Promise<StudioRelease[]> {
  const owners = await names(db, rows.map((r) => strOrNull(r.owner_id)));
  return rows.map((r) => toRelease(r, owners));
}

/** Newest year first, then title. Collections with no year last. */
export async function listReleases(db: Scoped): Promise<StudioRelease[]> {
  const rows = await db.q(`${RELEASE_SELECT} where ${VISIBLE} order by c.year desc nulls last, p.title`);
  return toReleases(db, rows);
}

export async function getRelease(db: Scoped, id: number): Promise<StudioRelease | null> {
  const rows = await db.q(`${RELEASE_SELECT} where p.id = $1 and ${VISIBLE}`, [id]);
  return rows.length ? (await toReleases(db, rows))[0] : null;
}

export async function createRelease(db: Scoped, input: {
  title: string;
  kind: ReleaseKind;
  artistId: number | null;
  year: number | null;
  by: string;
}): Promise<StudioRelease> {
  const rows = await db.q(
    `with p as (
       insert into projects (kind, title, created_by) values ('collection', $1, $2) returning id
     ), c as (
       insert into collections (project_id, form, artist_id, year)
       select id, $3, $4, $5 from p
     )
     select id from p`,
    [input.title, input.by, input.kind, input.artistId, input.year],
  );
  const release = await getRelease(db, num(rows[0].id));
  if (!release) throw new Error('collection vanished after insert');
  return release;
}

export async function updateRelease(
  db: Scoped,
  id: number,
  patch: { title?: string; kind?: ReleaseKind; artistId?: number | null; year?: number | null; notes?: string },
): Promise<StudioRelease | null> {
  const queries: Statement[] = [];
  if (patch.title !== undefined) queries.push({ text: 'update projects set title = $1 where id = $2', params: [patch.title, id] });
  const set: string[] = [];
  const params: unknown[] = [];
  if (patch.kind !== undefined) set.push(`form = $${params.push(patch.kind)}`);
  if (patch.artistId !== undefined) set.push(`artist_id = $${params.push(patch.artistId)}`);
  if (patch.year !== undefined) set.push(`year = $${params.push(patch.year)}`);
  if (patch.notes !== undefined) set.push(`notes = $${params.push(patch.notes)}`);
  if (set.length) queries.push({ text: `update collections set ${set.join(', ')} where project_id = $${params.push(id)}`, params });
  if (queries.length) await db.tx(queries);
  return getRelease(db, id);
}

/** Removes the collection and its running order. The sessions and their audio are untouched. */
export async function deleteRelease(db: Scoped, id: number): Promise<void> {
  await db.q(`delete from projects where id = $1 and kind = 'collection'`, [id]);
}

/** The collection's sessions in running order, each with its current mix. */
export async function releaseProjects(db: Scoped, releaseId: number): Promise<StudioProject[]> {
  const [rows, all] = await Promise.all([
    db.q('select child_id from project_parts where parent_id = $1 order by position', [releaseId]),
    listProjects(db),
  ]);
  const byId = new Map(all.map((p) => [p.id, p]));
  return rows.map((r) => byId.get(num(r.child_id))).filter((p): p is StudioProject => !!p);
}

/** Append sessions to the end of the running order; ones already on it are skipped. */
export async function addToRelease(db: Scoped, releaseId: number, projectIds: number[]): Promise<void> {
  const ids = Array.from(new Set(projectIds));
  if (!ids.length) return;
  await db.q(
    `insert into project_parts (parent_id, child_id, position)
     select $1, x.id, coalesce((select max(position) from project_parts where parent_id = $1), 0) + x.n
     from unnest($2::bigint[]) with ordinality as x(id, n)
     where not exists (select 1 from project_parts where parent_id = $1 and child_id = x.id)`,
    [releaseId, ids],
  );
}

/** Set the running order: positions 1..n in the order given. Ids not on the collection are ignored. */
export async function reorderRelease(db: Scoped, releaseId: number, projectIds: number[]): Promise<void> {
  if (!projectIds.length) return;
  await db.q(
    `update project_parts pp set position = x.n
     from unnest($2::bigint[]) with ordinality as x(id, n)
     where pp.parent_id = $1 and pp.child_id = x.id`,
    [releaseId, projectIds],
  );
}

/** Take one session off a collection, then close the gap in the running order. */
export async function removeFromRelease(db: Scoped, releaseId: number, projectId: number): Promise<void> {
  await db.tx([
    { text: 'delete from project_parts where parent_id = $1 and child_id = $2', params: [releaseId, projectId] },
    {
      text: `update project_parts pp set position = r.n
       from (select child_id, row_number() over (order by position) as n
             from project_parts where parent_id = $1) r
       where pp.parent_id = $1 and pp.child_id = r.child_id`,
      params: [releaseId],
    },
  ]);
}

/** The collections one session is part of. */
export async function releasesForProject(db: Scoped, projectId: number): Promise<StudioRelease[]> {
  const rows = await db.q(
    `${RELEASE_SELECT} where p.id in (select parent_id from project_parts where child_id = $1) and ${VISIBLE}
     order by c.year desc nulls last, p.title`,
    [projectId],
  );
  return toReleases(db, rows);
}

// ── Sharing (REQUIREMENTS AC-5, G-7) ─────────────────────────────────────────
//
// Shares on projects and on gear units live in one table with one column per
// kind of item. Only an item's owner can read or change its shares; the
// database's policies and triggers enforce that and write every change to the
// access log. A grantee sees their own share rows.

export type ShareItem = { kind: 'project'; id: number } | { kind: 'gear'; id: number };

const SHARE_COLUMNS = 'id, project_id, gear_id, grantee_id, level, granted_at';

function toShare(r: Row, who: Map<string, string>): StudioShare {
  return {
    id: num(r.id),
    projectId: numOrNull(r.project_id),
    gearId: numOrNull(r.gear_id),
    granteeId: String(r.grantee_id),
    granteeName: nameOf(who, String(r.grantee_id)),
    level: String(r.level) as ShareLevel,
    grantedAt: iso(r.granted_at),
  };
}

function itemColumn(item: ShareItem): 'project_id' | 'gear_id' {
  return item.kind === 'project' ? 'project_id' : 'gear_id';
}

export async function listShares(db: Scoped, item: ShareItem): Promise<StudioShare[]> {
  const rows = await db.q(
    `select ${SHARE_COLUMNS} from shares where ${itemColumn(item)} = $1 order by granted_at`,
    [item.id],
  );
  const who = await names(db, rows.map((r) => String(r.grantee_id)));
  return rows.map((r) => toShare(r, who));
}

export async function getShare(db: Scoped, id: number): Promise<StudioShare | null> {
  const rows = await db.q(`select ${SHARE_COLUMNS} from shares where id = $1`, [id]);
  if (!rows.length) return null;
  return toShare(rows[0], await names(db, [String(rows[0].grantee_id)]));
}

export type ShareResult =
  | { ok: true; share: StudioShare }
  | { ok: false; reason: 'no-account' | 'self' | 'exists' };

/** Share with the active account that has this email. */
export async function addShare(db: Scoped, item: ShareItem, email: string, level: ShareLevel): Promise<ShareResult> {
  const found = await db.q('select user_id from find_account($1)', [email]);
  if (!found.length) return { ok: false, reason: 'no-account' };
  const granteeId = String(found[0].user_id);
  if (granteeId === db.person.userId) return { ok: false, reason: 'self' };
  try {
    const rows = await db.q(
      `insert into shares (${itemColumn(item)}, grantee_id, level) values ($1, $2, $3) returning ${SHARE_COLUMNS}`,
      [item.id, granteeId, level],
    );
    return { ok: true, share: toShare(rows[0], await names(db, [granteeId])) };
  } catch (err) {
    if (pgError(err).code === UNIQUE_VIOLATION) return { ok: false, reason: 'exists' };
    throw err;
  }
}

export async function updateShare(db: Scoped, id: number, level: ShareLevel): Promise<StudioShare | null> {
  await db.q('update shares set level = $2 where id = $1', [id, level]);
  return getShare(db, id);
}

export async function deleteShare(db: Scoped, id: number): Promise<void> {
  await db.q('delete from shares where id = $1', [id]);
}

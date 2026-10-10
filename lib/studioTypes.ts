// Studio shapes and input rules, shared by server and client.
//
// Ported from Vivarium. No imports, so client components can use these without
// pulling the database client (lib/studio.ts) into the browser bundle.

export type StudioArtist = { id: number; code: string; name: string };

export type StudioProject = {
  id: number;
  artist: StudioArtist;
  /** The Ableton folder name. Permanent: the database refuses to change it. */
  canonicalId: string;
  workingName: string;
  /** 0 = unrated, 1–5 stars. One shared rating per project. */
  rating: number;
  /** Free text; '' when not set. */
  genre: string;
  /** Beats per minute; null when not set. */
  bpm: number | null;
  createdBy: string;
  createdAt: string;
  /**
   * The newest reference track, for the list's player. Filled in by
   * listProjects only; responses about a single project leave it undefined,
   * and the list keeps whatever it already had.
   */
  latest?: LatestTrack | null;
  /** Releases this session is on. Filled in by listProjects only, like `latest`. */
  releaseIds?: number[];
};

// A collection's form (collections.form). Vivarium's 'album' became 'lp'.
export const RELEASE_KINDS = ['lp', 'ep', 'single', 'compilation', 'multipart', 'other'] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];
export const RELEASE_KIND_LABEL: Record<ReleaseKind, string> = {
  lp: 'LP',
  ep: 'EP',
  single: 'Single',
  compilation: 'Compilation',
  multipart: 'Multi-part composition',
  other: 'Other',
};

export type StudioRelease = {
  id: number;
  title: string;
  kind: ReleaseKind;
  /** null: various artists, or not decided yet. */
  artist: StudioArtist | null;
  year: number | null;
  notes: string;
  createdAt: string;
  trackCount: number;
};

export function parseReleaseTitle(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'Give the release a title.' };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length > 200) return { error: 'Keep the title under 200 characters.' };
  return { value };
}

export type LatestTrack = {
  trackId: number;
  version: number;
  durationS: number | null;
  uploadedAt: string;
  /** How many versions the project has. */
  count: number;
};

/** One reference MP3. The audio itself is only reachable through the app's signed links. */
export type StudioTrack = {
  id: number;
  projectId: number;
  version: number;
  originalFilename: string;
  bytes: number | null;
  durationS: number | null;
  uploadedBy: string;
  /** The uploader's artist code (VIG, KJI …), or null when they have no studio_members row. */
  uploadedByCode: string | null;
  uploadedAt: string;
};

/** One entry in a project's working-name history. */
export type StudioName = { name: string; setBy: string; setByCode: string | null; setAt: string };

/**
 * The filename a download saves as: "VIG 2026 0926 — Querencia — v3.mp3".
 * Characters that are illegal in macOS or Windows filenames become spaces.
 */
export function downloadName(project: Pick<StudioProject, 'artist' | 'canonicalId' | 'workingName'>, version: number): string {
  const parts = [`${project.artist.code} ${project.canonicalId}`];
  if (project.workingName) parts.push(project.workingName);
  parts.push(`v${version}`);
  return `${parts.join(' — ')}.mp3`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ');
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A note on a project, optionally about one reference track. */
export type StudioNote = {
  id: number;
  projectId: number;
  /** null: about the project as a whole, or about a version since deleted. */
  trackId: number | null;
  /** The version number of trackId, for display ("v3"). */
  trackVersion: number | null;
  author: string;
  /** The author's artist code (VIG, KJI …), or null when they have no studio_members row. */
  authorCode: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
};

export const NOTE_MAX = 10_000;

export function parseNoteBody(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'Write something first.' };
  const value = raw.replace(/\s+$/, '').replace(/^\s*\n/, '');
  if (value.length > NOTE_MAX) return { error: `Keep a note under ${NOTE_MAX.toLocaleString()} characters.` };
  return { value };
}

export const CANONICAL_ID_MAX = 80;
export const WORKING_NAME_MAX = 200;
export const RATING_MAX = 5;

export const GENRE_MAX = 60;
export const BPM_MIN = 20;
export const BPM_MAX = 400;

export function parseGenre(raw: unknown): { value: string } | { error: string } {
  if (raw === undefined || raw === null) return { value: '' };
  if (typeof raw !== 'string') return { error: 'The genre must be text.' };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length > GENRE_MAX) return { error: `Keep the genre under ${GENRE_MAX} characters.` };
  return { value };
}

/** Accepts a number or numeric text; '' or null clears it. Two decimal places, like the column. */
export function parseBpm(raw: unknown): { value: number | null } | { error: string } {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { value: null };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n < BPM_MIN || n > BPM_MAX) {
    return { error: `BPM must be a number from ${BPM_MIN} to ${BPM_MAX}.` };
  }
  return { value: Math.round(n * 100) / 100 };
}

export function parseRating(raw: unknown): { value: number } | { error: string } {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > RATING_MAX) {
    return { error: `The rating must be a whole number from 0 to ${RATING_MAX}.` };
  }
  return { value: raw };
}

/**
 * A canonical ID is whatever the project's folder is called, usually a date
 * ('2026 0926'), so the format is not enforced. What is refused: empty, too
 * long, surrounding whitespace (trimmed here, and rejected by the database
 * CHECK if it ever arrived untrimmed), control characters, and path separators,
 * which cannot be part of a folder name anyway.
 */
export function parseCanonicalId(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Enter a canonical ID.' };
  const value = raw.trim();
  if (!value) return { error: 'Enter a canonical ID.' };
  if (value.length > CANONICAL_ID_MAX) return { error: `Keep the canonical ID under ${CANONICAL_ID_MAX} characters.` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f/\\:]/.test(value)) {
    return { error: 'The canonical ID cannot contain slashes, colons or control characters.' };
  }
  return { value };
}

export function parseWorkingName(raw: unknown): { value: string } | { error: string } {
  if (raw === undefined || raw === null) return { value: '' };
  if (typeof raw !== 'string') return { error: 'The working name must be text.' };
  const value = raw.trim();
  if (value.length > WORKING_NAME_MAX) return { error: `Keep the working name under ${WORKING_NAME_MAX} characters.` };
  return { value };
}

/** Today in the viewer's own time zone, in the studio's folder format: '2026 0926'. */
export function todayCanonicalId(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()} ${mm}${dd}`;
}

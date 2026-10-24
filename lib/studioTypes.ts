// Studio shapes and input rules, shared by server and client.
//
// Ported from Vivarium. No imports, so client components can use these without
// pulling the database client (lib/studio.ts) into the browser bundle.

export type StudioArtist = {
  id: number;
  code: string;
  name: string;
  /** Belongs to the viewer's own account. */
  mine?: boolean;
  /** One the viewer can credit their projects to: their own, or shared with them to edit (db/028). */
  creditable?: boolean;
};

/** What the viewer may do with a project (db/002 project_level; REQUIREMENTS AC-5). */
export type AccessLevel = 'owner' | 'edit' | 'contribute' | 'view';

const LEVEL_RANK: Record<AccessLevel, number> = { view: 1, contribute: 2, edit: 3, owner: 4 };

export function levelAtLeast(level: AccessLevel | null | undefined, minimum: AccessLevel): boolean {
  return !!level && LEVEL_RANK[level] >= LEVEL_RANK[minimum];
}

export const SHARE_LEVELS = ['view', 'contribute', 'edit'] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];
export const SHARE_LEVEL_LABEL: Record<ShareLevel, string> = {
  view: 'View: listen, download, read notes',
  contribute: 'Contribute: also upload and add notes',
  edit: 'Edit: also change title, rating, genre, BPM, current mix',
};

/** One person an owner has shared a project with. */
export type StudioShare = {
  id: number;
  /** One of these is set: the item shared. */
  projectId: number | null;
  gearId: number | null;
  granteeId: string;
  granteeName: string;
  level: ShareLevel;
  grantedAt: string;
};

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
  /** The owning account (REQUIREMENTS AC-3). */
  ownerId: string;
  /** The owner's display name, shown on items shared with the viewer. */
  ownerName: string;
  /** What the viewer may do with it. */
  level: AccessLevel;
  /**
   * The mix chosen by hand as current, or null when the newest mix is current.
   * Set on every project response.
   */
  currentMixId?: number | null;
  /**
   * The current mix (chosen by hand, else the newest), for the list's player. Filled in by
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
  ownerId: string;
  ownerName: string;
  level: AccessLevel;
};

export function parseReleaseTitle(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'Give the collection a title.' };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length > 200) return { error: 'Keep the title under 200 characters.' };
  return { value };
}

export type LatestTrack = {
  trackId: number;
  version: number;
  /** "v3", or "Radio edit v1" for a variant (db/013). */
  label: string;
  /** '' for the main mix, else the variant's name (db/015). */
  variant: string;
  durationS: number | null;
  uploadedAt: string;
  /** How many versions the project has. */
  count: number;
};

/**
 * A track by another artist, kept beside a session's own mixes for comparison
 * (a ghost track). Unnumbered; credited with artist and title.
 */
export type StudioReference = {
  id: number;
  projectId: number;
  /** "Artist — Title", as typed at upload; '' when not given. */
  credit: string;
  originalFilename: string;
  bytes: number | null;
  durationS: number | null;
  /** The loudness outline the player draws (db/009): up to 2000 values, 0–255; null until measured. */
  peaks: number[] | null;
  /** The uploader's account, or null for uploads recorded before accounts existed. */
  uploadedById: string | null;
  /** The uploader's display name. */
  uploadedByName: string;
  uploadedAt: string;
};

export const CREDIT_MAX = 200;

export function parseCredit(raw: unknown): { value: string } | { error: string } {
  if (raw === undefined || raw === null) return { value: '' };
  if (typeof raw !== 'string') return { error: 'The credit must be text.' };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length > CREDIT_MAX) return { error: `Keep the credit under ${CREDIT_MAX} characters.` };
  return { value };
}

/** The filename a reference downloads as: its credit, else the uploaded name. */
export function referenceDownloadName(r: Pick<StudioReference, 'credit' | 'originalFilename'>): string {
  if (!r.credit) return r.originalFilename;
  return `${r.credit}.mp3`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ');
}

/** One mix: a numbered bounce of the session. The audio itself is only reachable through the app's signed links. */
export type StudioTrack = {
  id: number;
  projectId: number;
  version: number;
  /** '' for the main mix, else the variant's name ("Radio edit"); versions count within it (db/013). */
  variant: string;
  /** "v3", or "Radio edit v1". */
  label: string;
  originalFilename: string;
  bytes: number | null;
  durationS: number | null;
  /** The loudness outline the player draws (db/009): up to 2000 values, 0–255; null until measured. */
  peaks: number[] | null;
  /** The uploader's account, or null for uploads recorded before accounts existed. */
  uploadedById: string | null;
  /** The uploader's display name. */
  uploadedByName: string;
  uploadedAt: string;
};

/**
 * A named variant of a session (db/015): "Radio edit" beside the main mix,
 * which has no entry and the empty name. Saved Live sets whose file name
 * contains match join it.
 */
export type StudioVariant = {
  id: number;
  name: string;
  /** Text in a saved set's file name that puts the save in this variant; any case. */
  match: string;
  mixes: number;
  saves: number;
};

/** One entry in a project's working-name history. */
export type StudioName = { name: string; setByName: string; setAt: string };

/**
 * The filename a download saves as: "VIG 2026 0926 — Querencia — v3.mp3".
 * Characters that are illegal in macOS or Windows filenames become spaces.
 */
export function downloadName(
  project: Pick<StudioProject, 'artist' | 'canonicalId' | 'workingName'>,
  version: number,
  variant = '',
): string {
  const parts = [`${project.artist.code} ${project.canonicalId}`];
  if (project.workingName) parts.push(project.workingName);
  parts.push(mixLabel(variant, version));
  return `${parts.join(' — ')}.mp3`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ');
}

/** How a mix is named everywhere: "v3", or "Radio edit v1" for a variant (db/013). */
export function mixLabel(variant: string, version: number | null): string {
  return version === null ? '' : variant ? `${variant} v${version}` : `v${version}`;
}

export const VARIANT_MAX = 40;

/** A variant's name as typed: '' (or "main") for the main mix. */
export function parseVariant(raw: unknown): { value: string } | { error: string } {
  if (raw === undefined || raw === null) return { value: '' };
  if (typeof raw !== 'string') return { error: 'The variant must be text.' };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.toLowerCase() === 'main' || value.toLowerCase() === 'main mix') return { value: '' };
  if (value.length > VARIANT_MAX) return { error: `Keep the variant's name under ${VARIANT_MAX} characters.` };
  return { value };
}

/** Suggestions offered at upload; any name may be typed. */
export const COMMON_VARIANTS = ['Radio edit', 'Extended', 'Instrumental', 'Club', 'Dub', 'Acapella'];

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A note on a project, optionally about one reference track. */
export type StudioNote = {
  id: number;
  projectId: number;
  /** null: about the project as a whole, or about a version since deleted. */
  trackId: number | null;
  /** The version number of trackId. */
  trackVersion: number | null;
  /** trackId's label for display: "v3", or "Radio edit v1". */
  trackLabel: string | null;
  /** The author's account, or null for notes written before accounts existed. */
  authorId: string | null;
  /** The author's display name. */
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** Seconds into the mix the note is about (db/009), or null. */
  positionS: number | null;
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

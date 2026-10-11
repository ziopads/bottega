import type { Scoped } from '@/lib/db';
import { accountNames, nameOf } from '@/lib/names';
import type { ShareLevel } from '@/lib/studioTypes';

// The account page's reads and writes (REQUIREMENTS AC-12, AC-13): the
// signed-in person's name, artists, preferences, shares in both directions,
// and activity. Every query runs as that person, so row-level security limits
// each to what is theirs.

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function pgError(err: unknown): { code?: string; message: string } {
  const e = err as { code?: string; message?: string };
  return { code: e?.code, message: e?.message ?? '' };
}

// ── Profile ──────────────────────────────────────────────────────────────────

export interface Profile {
  displayName: string;
  email: string;
  createdAt: string;
}

export async function getProfile(db: Scoped): Promise<Profile | null> {
  const rows = await db.q('select display_name, email, created_at from accounts where user_id = app_user()');
  if (!rows.length) return null;
  return { displayName: String(rows[0].display_name), email: String(rows[0].email), createdAt: iso(rows[0].created_at) };
}

export const MAX_DISPLAY_NAME = 80;

export async function setDisplayName(db: Scoped, name: string): Promise<string> {
  const rows = await db.q('select set_my_display_name($1) as name', [name]);
  return String(rows[0].name);
}

// ── Artists ──────────────────────────────────────────────────────────────────

export interface MyArtist {
  id: number;
  code: string;
  name: string;
  /** Sessions and releases credited to it; one in use cannot be deleted. */
  uses: number;
}

const ARTIST_SELECT = `
  select a.id, a.code, a.name,
         (select count(*) from music_projects m where m.artist_id = a.id)
       + (select count(*) from collections c where c.artist_id = a.id) as uses
    from artists a`;

function toArtist(r: Row): MyArtist {
  return { id: num(r.id), code: String(r.code), name: String(r.name), uses: num(r.uses) };
}

export async function listMyArtists(db: Scoped): Promise<MyArtist[]> {
  const rows = await db.q(`${ARTIST_SELECT} where a.account_id = app_user() order by a.code`);
  return rows.map(toArtist);
}

export type ArtistResult = { ok: true; artist: MyArtist } | { ok: false; reason: 'taken' | 'not-found' };

/** Codes are upper case, as the canonical ids that start with them. */
export function normalizeArtist(code: unknown, name: unknown): { code: string; name: string } | { error: string } {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  const n = typeof name === 'string' ? name.trim() : '';
  if (!/^[A-Z0-9]{1,12}$/.test(c)) return { error: 'A code is 1 to 12 letters or digits.' };
  if (!n) return { error: 'An artist needs a name.' };
  if (n.length > 120) return { error: 'A name can be at most 120 characters.' };
  return { code: c, name: n };
}

export async function createArtist(db: Scoped, code: string, name: string): Promise<ArtistResult> {
  try {
    const rows = await db.q('insert into artists (code, name) values ($1, $2) returning id', [code, name]);
    const found = await db.q(`${ARTIST_SELECT} where a.id = $1`, [rows[0].id]);
    return { ok: true, artist: toArtist(found[0]) };
  } catch (err) {
    if (pgError(err).code === '23505') return { ok: false, reason: 'taken' };
    throw err;
  }
}

export async function updateArtist(db: Scoped, id: number, code: string, name: string): Promise<ArtistResult> {
  try {
    const rows = await db.q(
      'update artists set code = $2, name = $3 where id = $1 and account_id = app_user() returning id',
      [id, code, name],
    );
    if (!rows.length) return { ok: false, reason: 'not-found' };
    const found = await db.q(`${ARTIST_SELECT} where a.id = $1`, [id]);
    return { ok: true, artist: toArtist(found[0]) };
  } catch (err) {
    if (pgError(err).code === '23505') return { ok: false, reason: 'taken' };
    throw err;
  }
}

export type DeleteArtistResult = { ok: true } | { ok: false; reason: 'in-use' | 'not-found' };

export async function deleteArtist(db: Scoped, id: number): Promise<DeleteArtistResult> {
  try {
    const rows = await db.q('delete from artists where id = $1 and account_id = app_user() returning id', [id]);
    return rows.length ? { ok: true } : { ok: false, reason: 'not-found' };
  } catch (err) {
    if (pgError(err).code === '23503') return { ok: false, reason: 'in-use' };
    throw err;
  }
}

// ── Preferences ──────────────────────────────────────────────────────────────

export interface Preferences {
  defaultArtistId: number | null;
}

export async function getPreferences(db: Scoped): Promise<Preferences> {
  const rows = await db.q('select default_artist_id from account_preferences where user_id = app_user()');
  const v = rows[0]?.default_artist_id;
  return { defaultArtistId: v === null || v === undefined ? null : num(v) };
}

export type PreferencesResult = { ok: true; preferences: Preferences } | { ok: false; reason: 'not-yours' };

export async function setDefaultArtist(db: Scoped, artistId: number | null): Promise<PreferencesResult> {
  try {
    await db.q(
      `insert into account_preferences (default_artist_id) values ($1)
       on conflict (user_id) do update set default_artist_id = excluded.default_artist_id`,
      [artistId],
    );
  } catch (err) {
    if (/default artist must be one of your own/.test(pgError(err).message)) return { ok: false, reason: 'not-yours' };
    throw err;
  }
  return { ok: true, preferences: await getPreferences(db) };
}

// ── Shares ───────────────────────────────────────────────────────────────────

export type ShareKind = 'project' | 'gear' | 'document';

export interface AccountShare {
  id: number;
  kind: ShareKind;
  itemId: number;
  itemLabel: string;
  href: string;
  /** Outgoing: the grantee. Incoming: the owner. */
  personName: string;
  level: ShareLevel;
  grantedAt: string;
}

// The item's name and its page, per kind. Collections are projects too.
const SHARE_SELECT = `
  select s.id, s.level, s.granted_at, s.grantee_id,
         case when s.project_id is not null then 'project' when s.gear_id is not null then 'gear' else 'document' end as kind,
         coalesce(s.project_id, s.gear_id, s.document_id) as item_id,
         coalesce(p.owner_id, g.owner_id, d.owner_id) as owner_id,
         p.kind as project_kind,
         case
           when p.id is not null then coalesce(nullif(btrim(concat_ws(' · ', mp.canonical_id, nullif(p.title, ''))), ''), 'untitled')
           when g.id is not null then coalesce(nullif(g.nickname, ''),
                                               btrim(coalesce(m.manufacturer, g.manufacturer) || ' ' || coalesce(m.model, g.name)))
           else d.title
         end as label
    from shares s
    left join projects p on p.id = s.project_id
    left join music_projects mp on mp.project_id = p.id
    left join gear g on g.id = s.gear_id
    left join gear_models m on m.id = g.model_id
    left join documents d on d.id = s.document_id`;

function hrefFor(kind: ShareKind, id: number, projectKind: unknown): string {
  if (kind === 'gear') return `/gear/${id}`;
  if (kind === 'document') return `/library/${id}`;
  return projectKind === 'collection' ? `/collections/${id}` : `/projects/${id}`;
}

async function toShares(db: Scoped, rows: Row[], person: 'grantee_id' | 'owner_id'): Promise<AccountShare[]> {
  const who = await accountNames(db, rows.map((r) => String(r[person])));
  return rows.map((r) => {
    const kind = String(r.kind) as ShareKind;
    return {
      id: num(r.id),
      kind,
      itemId: num(r.item_id),
      itemLabel: String(r.label ?? 'untitled'),
      href: hrefFor(kind, num(r.item_id), r.project_kind),
      personName: nameOf(who, String(r[person])),
      level: String(r.level) as ShareLevel,
      grantedAt: iso(r.granted_at),
    };
  });
}

/** Everything this person has shared, across projects, gear and documents. */
export async function listOutgoingShares(db: Scoped): Promise<AccountShare[]> {
  const rows = await db.q(
    `${SHARE_SELECT} where coalesce(p.owner_id, g.owner_id, d.owner_id) = app_user() order by label, s.granted_at`,
  );
  return toShares(db, rows, 'grantee_id');
}

/** Everything shared with this person. */
export async function listIncomingShares(db: Scoped): Promise<AccountShare[]> {
  const rows = await db.q(`${SHARE_SELECT} where s.grantee_id = app_user() order by s.granted_at desc`);
  return toShares(db, rows, 'owner_id');
}

// ── Activity ─────────────────────────────────────────────────────────────────

export interface ActivityEntry {
  id: number;
  at: string;
  text: string;
  actorName: string;
  /** The actor was this person. */
  mine: boolean;
}

const KIND_WORD: Record<string, string> = { project: 'session', gear: 'unit', document: 'document' };

function describe(r: Row, subjectName: string, itemLabel: string | null): string {
  const action = String(r.action);
  const before = (r.before ?? {}) as Record<string, unknown>;
  const after = (r.after ?? {}) as Record<string, unknown>;
  const item = itemLabel ? `“${itemLabel}”` : `a ${KIND_WORD[String(r.item_kind)] ?? 'item'}`;
  // Entries about another account (the administrator's approvals) name it.
  const whose = subjectName === 'you' ? '' : ` · ${subjectName}`;
  switch (action) {
    case 'account_created':
      return `Account created${whose}`;
    case 'account_changed':
      if (before.status !== after.status) return `Account ${after.status === 'active' ? 'approved' : String(after.status)}${whose}`;
      if (before.is_platform_admin !== after.is_platform_admin)
        return `${after.is_platform_admin ? 'Platform administration granted' : 'Platform administration withdrawn'}${whose}`;
      return `Account changed${whose}`;
    case 'display_name_changed':
      return `Display name changed to “${String(after.display_name ?? '')}”`;
    case 'password_changed':
      return 'Password changed';
    case 'token_issued':
      return 'Connector access granted';
    case 'token_revoked':
      return 'Connector access revoked';
    case 'share_granted':
      return `Shared ${item} with ${subjectName} (${String(after.level ?? '')})`;
    case 'share_changed':
      return `${subjectName}’s access to ${item} changed from ${String(before.level ?? '')} to ${String(after.level ?? '')}`;
    case 'share_revoked':
      return `Stopped sharing ${item} with ${subjectName}`;
    case 'limits_changed':
      return 'Allowances changed';
    case 'document_reviewed':
      return `Library submission ${item} ${String(after.review_status ?? 'reviewed')}`;
    case 'admin_view':
      return 'Viewed by the platform administrator';
    default:
      return action.replace(/_/g, ' ');
  }
}

/** The latest access-log entries about this person or their items (AC-12). */
export async function listActivity(db: Scoped, limit = 50): Promise<ActivityEntry[]> {
  const me = db.person.userId;
  const rows = await db.q(
    `select l.id, l.at, l.actor, l.action, l.subject_id, l.item_kind, l.item_id, l.before, l.after,
            case l.item_kind
              when 'project' then (select coalesce(nullif(btrim(concat_ws(' · ', mp.canonical_id, nullif(p.title, ''))), ''), 'untitled')
                                     from projects p left join music_projects mp on mp.project_id = p.id where p.id = l.item_id)
              when 'gear' then (select coalesce(nullif(g.nickname, ''), btrim(coalesce(m.manufacturer, g.manufacturer) || ' ' || coalesce(m.model, g.name)))
                                  from gear g left join gear_models m on m.id = g.model_id where g.id = l.item_id)
              when 'document' then (select d.title from documents d where d.id = l.item_id)
            end as item_label
       from access_log l
      where l.actor = app_user() or l.subject_id = app_user()
         or (l.item_kind = 'project' and project_rank(l.item_id) = 4)
         or (l.item_kind = 'gear' and gear_rank(l.item_id) = 4)
         or (l.item_kind = 'document' and document_rank(l.item_id) = 4)
      order by l.at desc, l.id desc
      limit $1`,
    [limit],
  );
  const who = await accountNames(
    db,
    rows.flatMap((r) => [String(r.actor), r.subject_id === null ? null : String(r.subject_id)]),
  );
  return rows.map((r) => {
    const actor = String(r.actor);
    const subject = r.subject_id === null ? null : String(r.subject_id);
    const subjectName = subject === me ? 'you' : nameOf(who, subject);
    return {
      id: num(r.id),
      at: iso(r.at),
      text: describe(r, subjectName, r.item_label === null ? null : String(r.item_label)),
      actorName: actor === me ? 'you' : who.get(actor) ?? (actor === 'bootstrap' || actor === 'owner role' ? 'the system' : 'someone'),
      mine: actor === me,
    };
  });
}

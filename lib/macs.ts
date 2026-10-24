import { createHash, randomBytes, randomInt } from 'node:crypto';

import { db, type Scoped } from '@/lib/db';
import { listTokens, type PersonalToken, type WatcherReport } from '@/lib/tokens';

// The Macs a person runs the watcher on (REQUIREMENTS A-10 to A-12, db/027).
// Each Mac has a name and its own sessions folder, set in Bottega. Adding one
// makes a setup code for the install command; the installer trades the code
// for a token made for that Mac, so no secret is ever shown on a page. The
// watcher reads its folder from Bottega at every start and sweep. Server only.

export type WatcherMac = {
  id: number;
  name: string;
  root: string;
  tokenId: number | null;
  createdAt: string;
  /** While a setup code is live: when it stops working. */
  codeExpiresAt: string | null;
};

export type MacsData = {
  macs: WatcherMac[];
  reports: WatcherReport[];
  /** Tokens made by hand before Macs (db/026) and still live. */
  otherTokens: PersonalToken[];
};

export class MacError extends Error {}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// No I, L, O, 0 or 1: a code is read off one screen and typed or pasted on another.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** A setup code as shown, such as K7QX-M2PL. */
function makeCode(): string {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += ALPHABET[randomInt(ALPHABET.length)];
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** The code as stored: its hash, ignoring case, spaces and dashes. */
function codeHash(code: string): string | null {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== CODE_LENGTH || [...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return sha(c);
}

/**
 * A folder path as pasted: Finder's Copy as Pathname gives it plain; a
 * folder dragged into Terminal gives it with backslashes before spaces, or
 * quoted. Returns the plain path, without a trailing slash.
 */
export function cleanRoot(raw: string): string {
  let p = raw.trim();
  if (p.length >= 2 && ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"')))) p = p.slice(1, -1);
  else if (/\\./.test(p)) p = p.replace(/\\(.)/g, '$1');
  if (p.startsWith('~/')) throw new MacError('Give the full path, starting with /Users/ or /Volumes/, without ~.');
  if (!p.startsWith('/')) throw new MacError('Give the full path of the folder, starting with /.');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p.length > 1024) throw new MacError('That path is too long.');
  return p;
}

function cleanName(raw: string): string {
  const n = raw.trim();
  if (!n) throw new MacError('Give the Mac a name.');
  if (n.length > 80) throw new MacError('Keep the name under 80 characters.');
  return n;
}

function rethrow(err: unknown): never {
  const msg = (err as { message?: string })?.message ?? '';
  if (/ten Macs at most|needs an active account|not one of yours/.test(msg)) throw new MacError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
  throw err;
}

export async function listMacs(person: Scoped): Promise<MacsData> {
  const [[macs], { tokens, reports }] = await Promise.all([
    person.tx([
      {
        text: `select id, name, root, token_id, created_at, case when setup_expires_at > now() then setup_expires_at end as code_expires_at
                 from watcher_macs where removed_at is null order by created_at`,
      },
    ]),
    listTokens(person),
  ]);
  const list = macs.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    root: String(r.root),
    tokenId: r.token_id === null ? null : Number(r.token_id),
    createdAt: iso(r.created_at),
    codeExpiresAt: r.code_expires_at === null ? null : iso(r.code_expires_at),
  }));
  const ofMacs = new Set(list.map((m) => m.tokenId).filter((t): t is number => t !== null));
  return { macs: list, reports, otherTokens: tokens.filter((t) => !t.revokedAt && !ofMacs.has(t.id)) };
}

/** Adds a Mac; returns its setup code, shown once in the install command. */
export async function addMac(person: Scoped, name: string, root: string): Promise<string> {
  const code = makeCode();
  try {
    await person.q('select mac_add($1, $2, $3)', [cleanName(name), cleanRoot(root), codeHash(code)]);
  } catch (err) {
    if (err instanceof MacError) throw err;
    rethrow(err);
  }
  return code;
}

export async function updateMac(person: Scoped, id: number, name: string | null, root: string | null): Promise<void> {
  const n = name === null ? null : cleanName(name);
  const r = root === null ? null : cleanRoot(root);
  try {
    await person.q('select mac_update($1, $2, $3)', [id, n, r]);
  } catch (err) {
    rethrow(err);
  }
}

/** A fresh setup code for a Mac, to install again. */
export async function newMacCode(person: Scoped, id: number): Promise<string> {
  const code = makeCode();
  try {
    await person.q('select mac_new_code($1, $2)', [id, codeHash(code)]);
  } catch (err) {
    rethrow(err);
  }
  return code;
}

export async function removeMac(person: Scoped, id: number): Promise<void> {
  try {
    await person.q('select mac_remove($1)', [id]);
  } catch (err) {
    rethrow(err);
  }
}

/**
 * The installer's half (before anyone is known): trades a setup code for a
 * new token made for that Mac. Null when the code is wrong, used or expired.
 */
export async function claimMac(code: string): Promise<{ token: string; name: string; root: string } | null> {
  const h = codeHash(code);
  if (!h) return null;
  const token = `btg_${randomBytes(32).toString('base64url')}`;
  const rows = (await db().query('select name, root from mac_claim($1, $2, $3)', [h, sha(token), token.slice(0, 12)])) as { name: string; root: string }[];
  const row = rows[0];
  return row ? { token, name: String(row.name), root: String(row.root) } : null;
}

/** For the watcher: its Mac's name and folder; null for a token made by hand. */
export async function macConfig(person: Scoped, tokenId: number): Promise<{ name: string; root: string } | null> {
  const rows = await person.q('select name, root from mac_config($1)', [tokenId]);
  return rows[0] ? { name: String(rows[0].name), root: String(rows[0].root) } : null;
}

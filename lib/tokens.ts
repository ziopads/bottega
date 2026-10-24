import { createHash, randomBytes } from 'node:crypto';

import { NextResponse } from 'next/server';

import { db, forPerson, type Scoped } from '@/lib/db';

// Personal access tokens (REQUIREMENTS AC-15, db/026): secrets a person makes
// under Account › Security for a program of theirs, today the Mac watcher
// (A-9). The secret is shown once; only its SHA-256 is stored. Server only.

export type PersonalToken = { id: number; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

export type WatcherReport = {
  tokenId: number;
  reportedAt: string;
  version: string;
  host: string;
  root: string;
  pending: number;
  unmatched: string[];
  /** Whether the Mac found its sessions folder; null from a watcher before 1.1. */
  rootFound: boolean | null;
};

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

export class TokenError extends Error {}

export async function listTokens(person: Scoped): Promise<{ tokens: PersonalToken[]; reports: WatcherReport[] }> {
  const [tokens, reports] = await person.tx([
    { text: 'select id, name, prefix, created_at, last_used_at, revoked_at from personal_tokens order by created_at desc', params: [] },
    { text: 'select token_id, reported_at, version, host, root, pending, unmatched, root_found from watcher_reports order by reported_at desc', params: [] },
  ]);
  return {
    tokens: tokens.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      prefix: String(r.prefix),
      createdAt: iso(r.created_at),
      lastUsedAt: isoOrNull(r.last_used_at),
      revokedAt: isoOrNull(r.revoked_at),
    })),
    reports: reports.map((r) => ({
      tokenId: Number(r.token_id),
      reportedAt: iso(r.reported_at),
      version: String(r.version),
      host: String(r.host),
      root: String(r.root),
      pending: Number(r.pending),
      unmatched: Array.isArray(r.unmatched) ? r.unmatched.map(String) : [],
      rootFound: typeof r.root_found === 'boolean' ? r.root_found : null,
    })),
  };
}

/** Makes a token and returns its secret, which is never readable again. */
export async function createToken(person: Scoped, name: string): Promise<string> {
  const secret = `btg_${randomBytes(32).toString('base64url')}`;
  try {
    await person.q('select token_create($1, $2, $3)', [name, hash(secret), secret.slice(0, 12)]);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? '';
    if (/ten tokens at most|needs an active account/.test(msg)) throw new TokenError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
    throw err;
  }
  return secret;
}

export async function revokeToken(person: Scoped, id: number): Promise<void> {
  await person.q('select token_revoke($1)', [id]);
}

export type TokenAccount = { db: Scoped; userId: string; tokenId: number };

/**
 * For the watcher's route handlers: the person a bearer token belongs to, or
 * the JSON response to return. The guard of every route under api/watcher.
 */
export async function tokenAccount(req: Request): Promise<TokenAccount | NextResponse> {
  const header = req.headers.get('authorization') ?? '';
  const m = header.match(/^Bearer\s+(btg_[A-Za-z0-9_-]{20,})$/);
  if (!m) return NextResponse.json({ error: 'A personal access token is required.' }, { status: 401 });
  const rows = (await db().query('select user_id, token_id from token_verify($1, $2)', [hash(m[1]), 'sets'])) as { user_id: string; token_id: string | number }[];
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'That token is not valid, has been revoked, or its account is not active.' }, { status: 401 });
  return { db: forPerson({ userId: row.user_id }), userId: row.user_id, tokenId: Number(row.token_id) };
}

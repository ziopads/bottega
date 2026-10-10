import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth/server';
import { forPerson, type Scoped } from '@/lib/db';

// Authorization above the database's row-level security (ARCHITECTURE §11).
//
// Neon Auth says who someone is. This file decides what happens next:
//
//   - a session with no accounts row is registered as pending (AC-1), by the
//     database function register_session, which also writes the log entry;
//   - pending and disabled people reach nothing but /auth/pending;
//   - an active account gets a Scoped handle, the only way to query account
//     data, which runs every statement as that person.
//
// The database refuses on its own whatever this file forgets. What this file
// adds is a clear answer: a redirect, a 404 for an item the person cannot see
// (its existence is not disclosed), a 403 for one they can see but not change.
//
// Every page, route handler and Server Action calls requireAccount() or
// apiAccount() before touching data; scripts/check-access.mjs enforces it.

export type AccountStatus = 'pending' | 'active' | 'disabled';
export type Level = 'view' | 'contribute' | 'edit' | 'owner';

const RANK: Record<Level, number> = { view: 1, contribute: 2, edit: 3, owner: 4 };

export interface Account {
  userId: string;
  email: string;
  name: string;
  status: AccountStatus;
  isPlatformAdmin: boolean;
  /** Queries as this person. */
  db: Scoped;
}

/**
 * The signed-in person's account, registering it as pending on first sight,
 * or null with no session. Memoized per request, so the layout and the page
 * share one lookup.
 */
export const getAccount = cache(async (): Promise<Account | null> => {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user?.id || !user.email) return null;

  const scoped = forPerson({ userId: user.id });
  const rows = await scoped.q('select status, is_platform_admin from register_session($1, $2)', [
    user.email,
    user.name ?? '',
  ]);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: user.id,
    email: user.email.toLowerCase(),
    name: user.name ?? '',
    status: row.status as AccountStatus,
    isPlatformAdmin: row.is_platform_admin === true,
    db: scoped,
  };
});

/** For pages and Server Actions: an active account, or a redirect. */
export async function requireAccount(): Promise<Account> {
  const account = await getAccount();
  if (!account) redirect('/auth/sign-in');
  if (account.status !== 'active') redirect('/auth/pending');
  return account;
}

/** For pages only the platform administrator may open; anyone else gets a 404. */
export async function requirePlatformAdmin(): Promise<Account> {
  const account = await requireAccount();
  if (!account.isPlatformAdmin) notFound();
  return account;
}

/**
 * For route handlers: an active account, or the JSON response to return.
 *
 *   const a = await apiAccount();
 *   if (a instanceof NextResponse) return a;
 */
export async function apiAccount(): Promise<Account | NextResponse> {
  const account = await getAccount();
  if (!account) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  if (account.status !== 'active') {
    return NextResponse.json({ error: 'This account is awaiting approval.' }, { status: 403 });
  }
  return account;
}

/** What this person may do with a project: owner, edit, contribute, view, or null. */
export async function projectLevel(db: Scoped, projectId: number): Promise<Level | null> {
  const rows = await db.q('select project_level($1) as level', [projectId]);
  const level = rows[0]?.level;
  return typeof level === 'string' ? (level as Level) : null;
}

export function atLeast(level: Level | null, minimum: Level): boolean {
  return level !== null && RANK[level] >= RANK[minimum];
}

/**
 * For route handlers acting on one project: null when the person may proceed,
 * otherwise the response to return. 404 when the project is invisible to
 * them, 403 when visible below the level needed.
 */
export async function projectRefusal(
  db: Scoped,
  projectId: number,
  minimum: Level,
): Promise<NextResponse | null> {
  const level = await projectLevel(db, projectId);
  if (level === null) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!atLeast(level, minimum)) {
    const need = minimum === 'owner' ? 'Only the owner can do that.' : `That needs ${minimum} access.`;
    return NextResponse.json({ error: need }, { status: 403 });
  }
  return null;
}

/**
 * The platform administrator's read-only view of another account (AC-9).
 * Writes the access log entry, then returns a handle that can read every
 * account's items; the admin pages filter by owner to the account being
 * viewed. The database refuses every write made through it.
 */
export async function adminViewOf(admin: Account, accountId: string, path: string): Promise<Scoped> {
  if (!admin.isPlatformAdmin) throw new Error('adminViewOf: not the platform administrator');
  await admin.db.q('select log_event($1, $2, null, null, $3)', [
    'admin_view',
    accountId,
    JSON.stringify({ path }),
  ]);
  return forPerson({ userId: admin.userId, adminView: true });
}

/** Records a password change in the access log (AC-11). */
export async function logPasswordChange(account: Account): Promise<void> {
  await account.db.q("select log_event('password_changed', null, null, null, null)");
}

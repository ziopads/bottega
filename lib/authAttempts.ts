import { headers } from 'next/headers';

import { db } from '@/lib/db';

// Bottega's own limit on sign-in and sign-up attempts (db/021). Neon Auth
// sees Vercel's address for every server-side call, so its own limit cannot
// tell one guesser from everyone else; this one counts by email and by the
// caller's address, which Vercel passes in x-forwarded-for. Nobody is signed
// in yet, so these run as the application role with no person set, through
// two functions; the table is not readable to the role, and keeps only
// hashes. Server only.

export type AttemptKind = 'sign-in' | 'sign-up';

export async function callerAddress(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || h.get('x-real-ip') || 'unknown';
}

/** Seconds to wait before another attempt; 0 to go ahead. A database failure lets the attempt through. */
export async function attemptWait(kind: AttemptKind, email: string, address: string): Promise<number> {
  try {
    const rows = (await db().query('select auth_attempt_wait($1, $2, $3) as wait', [kind, email, address])) as { wait: number }[];
    return Number(rows[0]?.wait ?? 0);
  } catch (err) {
    console.error('[auth-attempts] wait', err);
    return 0;
  }
}

export async function recordAttempt(kind: AttemptKind, email: string, address: string, ok: boolean): Promise<void> {
  try {
    await db().query('select auth_attempt_record($1, $2, $3, $4)', [kind, email, address, ok]);
  } catch (err) {
    console.error('[auth-attempts] record', err);
  }
}

export function waitMessage(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

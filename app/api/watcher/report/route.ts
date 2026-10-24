import { NextResponse } from 'next/server';

import { tokenAccount } from '@/lib/tokens';
import { bad, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// POST /api/watcher/report   { version, host, root, pending, unmatched: string[], rootFound? }
// The Mac watcher says it is alive, how many sets wait to be sent, and the
// folders it found no project for (REQUIREMENTS A-9, db/026). Shown under
// Account › Security. rootFound (db/027): whether the Mac found its folder.
export async function POST(req: Request) {
  const account = await tokenAccount(req);
  if (account instanceof NextResponse) return account;
  const b = await readBody(req);
  if (!b) return bad('Invalid body');
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const unmatched = Array.isArray(b.unmatched) ? b.unmatched.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 255)).slice(0, 500) : [];
  const pending = Number.isInteger(b.pending) && (b.pending as number) >= 0 ? (b.pending as number) : 0;
  await account.db.q('select watcher_report($1, $2, $3, $4, $5, $6, $7)', [
    account.tokenId,
    str(b.version, 40),
    str(b.host, 120),
    str(b.root, 1024),
    pending,
    unmatched,
    typeof b.rootFound === 'boolean' ? b.rootFound : null,
  ]);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';

import { claimMac } from '@/lib/macs';
import { bad, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// POST /api/watcher/claim   { code } → { token, name, root }
// The installer on a Mac trades the setup code from Account › Security for a
// token made for that Mac (REQUIREMENTS A-11, db/027). Called before anyone is
// known: the code is the proof. It is eight characters from 31, lasts fifteen
// minutes and works once; the token goes straight into the Mac's keychain.
export async function POST(req: Request) {
  const b = await readBody(req);
  if (!b || typeof b.code !== 'string') return bad('Give the setup code.');
  const claimed = await claimMac(b.code);
  if (!claimed) return bad('That setup code is not valid: it may have expired or been used. Make a new one under Account › Security.', 401);
  return NextResponse.json(claimed, { headers: { 'cache-control': 'no-store' } });
}

import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { listLargest, USAGE_KINDS, type UsageKind } from '@/lib/usage';

export const dynamic = 'force-dynamic';

// The largest files of one kind the signed-in person stores, a page at a
// time, for the Usage tab (REQUIREMENTS O-7).

// GET /api/account/usage?kind=audio&offset=0
export async function GET(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') as UsageKind;
  if (!USAGE_KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) {
    return NextResponse.json({ error: 'Invalid offset' }, { status: 400 });
  }
  return NextResponse.json(await listLargest(account.db, kind, offset));
}

import { NextResponse } from 'next/server';

import { macConfig } from '@/lib/macs';
import { tokenAccount } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

// GET /api/watcher/config → { name, root } | { name: null, root: null }
// The watcher's Mac as set in Bottega (REQUIREMENTS A-12, db/027), read at every
// start and sweep, so a folder changed under Account › Security reaches the
// Mac. A token made by hand belongs to no Mac and keeps its local settings.
export async function GET(req: Request) {
  const account = await tokenAccount(req);
  if (account instanceof NextResponse) return account;
  const mac = await macConfig(account.db, account.tokenId);
  return NextResponse.json(mac ?? { name: null, root: null });
}

import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { addMac, listMacs, MacError, newMacCode, removeMac, updateMac } from '@/lib/macs';
import { revokeToken } from '@/lib/tokens';
import { bad, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// The Macs the person runs the watcher on, their watchers' reports, and any
// token made by hand before Macs (REQUIREMENTS A-10 to A-12, AC-15; db/027).

// GET /api/account/macs
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  return NextResponse.json(await listMacs(account.db));
}

// POST /api/account/macs
//   { op: 'add', name, root }        → { code, ...list }
//   { op: 'update', id, name?, root? }
//   { op: 'new-code', id }           → { code, ...list }
//   { op: 'remove', id }
//   { op: 'revoke-token', id }       a token made by hand
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const b = await readBody(req);
  if (!b) return bad('Invalid body');
  const id = Number.isInteger(b.id) && (b.id as number) > 0 ? (b.id as number) : null;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  let code: string | undefined;
  try {
    if (b.op === 'add') {
      code = await addMac(account.db, str(b.name) ?? '', str(b.root) ?? '');
    } else if (b.op === 'update') {
      if (!id) return bad('Name a Mac');
      await updateMac(account.db, id, str(b.name), str(b.root));
    } else if (b.op === 'new-code') {
      if (!id) return bad('Name a Mac');
      code = await newMacCode(account.db, id);
    } else if (b.op === 'remove') {
      if (!id) return bad('Name a Mac');
      await removeMac(account.db, id);
    } else if (b.op === 'revoke-token') {
      if (!id) return bad('Name a token');
      await revokeToken(account.db, id);
    } else {
      return bad('Unknown operation');
    }
  } catch (err) {
    if (err instanceof MacError) return bad(err.message);
    throw err;
  }
  return NextResponse.json({ code, ...(await listMacs(account.db)) }, { headers: { 'cache-control': 'no-store' } });
}

import { NextResponse } from 'next/server';

import { projectRefusal } from '@/lib/access';
import { readSetInput } from '@/lib/als/input';
import { listSnapshotMeta, saveSnapshot } from '@/lib/als/store';
import { tokenAccount } from '@/lib/tokens';
import { bad, parseId } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// A project's saved sets, from the Mac watcher (REQUIREMENTS A-9, db/014,
// db/026): the same as dropping the folder on the State tab.

// GET /api/watcher/projects/:id/sets   the sets already stored (fingerprints and parser versions)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await tokenAccount(req);
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const refusal = await projectRefusal(account.db, id, 'edit');
  if (refusal) return refusal;
  return NextResponse.json({ snapshots: await listSnapshotMeta(account.db, id) });
}

// POST /api/watcher/projects/:id/sets   { fileName, savedAt, sha256, bytes, set }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await tokenAccount(req);
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const refusal = await projectRefusal(account.db, id, 'edit');
  if (refusal) return refusal;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad('Invalid body');
  }
  const input = readSetInput(body);
  if ('error' in input) return bad(input.error);
  return NextResponse.json({ result: await saveSnapshot(account.db, id, input) });
}

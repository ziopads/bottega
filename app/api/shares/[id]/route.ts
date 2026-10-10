import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { deleteShare, getShare, updateShare } from '@/lib/studio';
import { SHARE_LEVELS, type ShareLevel } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

// One share: change its level or revoke it. The item's owner only; the
// database logs both (REQUIREMENTS AC-5, AC-11).

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// PATCH /api/shares/:id   { level }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const share = await getShare(db, id);
  if (!share) return NextResponse.json({ error: 'Share not found' }, { status: 404 });
  const refusal = await projectRefusal(db, share.projectId, 'owner');
  if (refusal) return refusal;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const level = body.level as ShareLevel;
  if (!SHARE_LEVELS.includes(level)) return NextResponse.json({ error: 'Choose view, contribute or edit.' }, { status: 400 });
  return NextResponse.json({ share: await updateShare(db, id, level) });
}

// DELETE /api/shares/:id — revoke.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const share = await getShare(db, id);
  if (!share) return NextResponse.json({ error: 'Share not found' }, { status: 404 });
  const refusal = await projectRefusal(db, share.projectId, 'owner');
  if (refusal) return refusal;
  await deleteShare(db, id);
  return NextResponse.json({ ok: true });
}

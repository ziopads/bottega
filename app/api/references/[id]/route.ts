import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { deleteReferenceRow, getReferenceWithKey, updateReferenceCredit } from '@/lib/studio';
import { deleteAudio } from '@/lib/studioAudio';
import { parseCredit } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// PATCH /api/references/:id   { credit } — contribute access or above may correct a credit.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const credit = parseCredit(body.credit);
  if ('error' in credit) return NextResponse.json({ error: credit.error }, { status: 400 });
  const found = await getReferenceWithKey(db, id);
  if (!found) return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
  const refusal = await projectRefusal(db, found.reference.projectId, 'contribute');
  if (refusal) return refusal;
  const reference = await updateReferenceCredit(db, id, credit.value);
  if (!reference) return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
  return NextResponse.json({ reference });
}

// DELETE /api/references/:id — the project's owner only (REQUIREMENTS AC-7).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const found = await getReferenceWithKey(db, id);
  if (!found) return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
  const refusal = await projectRefusal(db, found.reference.projectId, 'owner');
  if (refusal) return refusal;
  await deleteReferenceRow(db, id);
  // Row first, then the object: a failed object delete leaves a harmless orphan.
  try {
    await deleteAudio(found.key);
  } catch (err) {
    console.error('reference audio delete failed', found.key, err);
  }
  return NextResponse.json({ ok: true });
}

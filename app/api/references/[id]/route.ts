import { NextResponse } from 'next/server';

import { deleteReferenceRow, getReferenceWithKey, getStudioViewer, isAdmin, updateReferenceCredit } from '@/lib/studio';
import { deleteAudio } from '@/lib/studioAudio';
import { parseCredit } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// PATCH /api/references/:id   { credit } — any studio member may correct a credit.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
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
  const reference = await updateReferenceCredit(id, credit.value);
  if (!reference) return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
  return NextResponse.json({ reference });
}

// DELETE /api/references/:id — whoever uploaded it, or an admin. Unlike mixes,
// references are not the archive of record, so the uploader may remove one.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const found = await getReferenceWithKey(id);
  if (!found) return NextResponse.json({ error: 'Reference not found' }, { status: 404 });
  if (found.reference.uploadedBy !== viewer.email && !isAdmin(viewer.email)) {
    return NextResponse.json({ error: 'Only whoever uploaded it, or an admin, can remove a reference.' }, { status: 403 });
  }
  await deleteReferenceRow(id);
  // Row first, then the object: a failed object delete leaves a harmless orphan.
  try {
    await deleteAudio(found.key);
  } catch (err) {
    console.error('reference audio delete failed', found.key, err);
  }
  return NextResponse.json({ ok: true });
}

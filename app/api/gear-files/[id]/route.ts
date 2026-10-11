import { NextResponse } from 'next/server';

import { apiAccount, gearRefusal } from '@/lib/access';
import { deleteFile, filesConfigured, signFileGet } from '@/lib/files';
import { deleteGearFileRow, getGearFileWithKey, updateGearFile } from '@/lib/gear';
import { FILE_ROLES, type GearFileRole } from '@/lib/gearTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/gear-files/:id              → redirect to a 10-minute signed link
// GET /api/gear-files/:id?download=1   → the same, saved under its filename
// The row is read as the signed-in person, so a receipt on someone else's
// unit, or a photo on a unit they cannot see, is not found.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  if (!filesConfigured()) return NextResponse.json({ error: 'File storage is not configured yet.' }, { status: 503 });
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const found = await getGearFileWithKey(account.db, id);
  if (!found) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const url = await signFileGet(found.key, {
    filename: found.file.filename,
    contentType: found.file.contentType,
    download: !!new URL(req.url).searchParams.get('download'),
  });
  const res = NextResponse.redirect(url, 302);
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

// PATCH /api/gear-files/:id   { caption?, role? } — the owner only.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const found = await getGearFileWithKey(db, id);
  if (!found) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const refusal = await gearRefusal(db, found.file.gearId, 'owner');
  if (refusal) return refusal;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const patch: { caption?: string; role?: GearFileRole } = {};
  if ('caption' in body) {
    if (typeof body.caption !== 'string') return NextResponse.json({ error: 'Invalid caption' }, { status: 400 });
    patch.caption = body.caption.trim().slice(0, 500);
  }
  if ('role' in body) {
    const role = body.role as GearFileRole;
    if (!FILE_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    if (role === 'photo' && !found.file.contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Only an image can be a photo.' }, { status: 400 });
    }
    patch.role = role;
  }
  return NextResponse.json({ file: await updateGearFile(db, id, patch) });
}

// DELETE /api/gear-files/:id — the owner only (REQUIREMENTS AC-7).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const found = await getGearFileWithKey(db, id);
  if (!found) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const refusal = await gearRefusal(db, found.file.gearId, 'owner');
  if (refusal) return refusal;
  await deleteGearFileRow(db, id);
  try {
    await deleteFile(found.key);
  } catch (err) {
    console.error('gear file delete failed', found.key, err);
  }
  return NextResponse.json({ ok: true });
}

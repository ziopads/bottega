import { NextResponse } from 'next/server';

import { apiAccount, gearRefusal } from '@/lib/access';
import { FILE_MAX_BYTES, FILE_TYPES, fileObject, filesConfigured, isAccountFileKey } from '@/lib/files';
import { addGearFile, getGear, listGearFiles } from '@/lib/gear';
import { FILE_ROLES, type GearFileRole } from '@/lib/gearTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/gear/:id/files — photos for anyone who can see the unit; every
// file for its owner (the database decides which rows come back).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await gearRefusal(account.db, id, 'view');
  if (refusal) return refusal;
  return NextResponse.json({ files: await listGearFiles(account.db, id) });
}

// POST /api/gear/:id/files   { key, filename, role }
// Step 2 of 2: record an upload that has reached R2. The key must be one
// issued for this unit under its owner's prefix; size and type are read back
// from R2, not taken from the browser.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  if (!filesConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured yet (R2_FILES_BUCKET).' }, { status: 503 });
  }
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const role = body.role as GearFileRole;
  if (!FILE_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid file role' }, { status: 400 });
  const key = typeof body.key === 'string' ? body.key : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim().slice(0, 255) : '';
  if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });

  const refusal = await gearRefusal(db, id, role === 'photo' ? 'contribute' : 'owner');
  if (refusal) return refusal;
  const unit = await getGear(db, id);
  if (!unit || !isAccountFileKey(key, unit.ownerId, 'gear', id)) {
    return NextResponse.json({ error: 'Invalid upload key' }, { status: 400 });
  }

  const stored = await fileObject(key);
  if (!stored) return NextResponse.json({ error: 'The upload did not reach storage. Please try again.' }, { status: 409 });
  if (!FILE_TYPES[stored.contentType] || stored.bytes > FILE_MAX_BYTES || (role === 'photo' && !stored.contentType.startsWith('image/'))) {
    return NextResponse.json({ error: 'The stored file is not an accepted type or size.' }, { status: 400 });
  }

  const file = await addGearFile(db, {
    gearId: id,
    role,
    key,
    filename,
    contentType: stored.contentType,
    bytes: stored.bytes,
  });
  return NextResponse.json({ file }, { status: 201 });
}

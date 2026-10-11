import { NextResponse } from 'next/server';

import { apiAccount, gearRefusal } from '@/lib/access';
import { FILE_MAX_BYTES, FILE_TYPES, filesConfigured, newAccountFileKey, signFileUpload } from '@/lib/files';
import { getGear } from '@/lib/gear';
import { FILE_ROLES, type GearFileRole } from '@/lib/gearTypes';

export const dynamic = 'force-dynamic';

// POST /api/gear/:id/files/upload   { filename, contentType, bytes, role }
// Step 1 of 2: a signed PUT into the files bucket under the unit owner's
// prefix (ARCHITECTURE §12). Photos need contribute access; receipts, serial
// plates and documents need ownership. Then POST /api/gear/:id/files.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  if (!filesConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured yet (R2_FILES_BUCKET).' }, { status: 503 });
  }
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const role = body.role as GearFileRole;
  if (!FILE_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid file role' }, { status: 400 });
  const contentType = typeof body.contentType === 'string' ? body.contentType : '';
  if (!FILE_TYPES[contentType]) {
    return NextResponse.json({ error: 'Upload a JPEG, PNG, WebP, HEIC or PDF.' }, { status: 400 });
  }
  if (role === 'photo' && !contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'A photo must be an image.' }, { status: 400 });
  }
  const bytes = Number(body.bytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
  if (bytes > FILE_MAX_BYTES) {
    return NextResponse.json({ error: `The file is over ${FILE_MAX_BYTES / (1024 * 1024)} MB.` }, { status: 400 });
  }

  const refusal = await gearRefusal(db, id, role === 'photo' ? 'contribute' : 'owner');
  if (refusal) return refusal;
  const unit = await getGear(db, id);
  if (!unit) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const key = newAccountFileKey(unit.ownerId, 'gear', id, contentType);
  return NextResponse.json({ url: await signFileUpload(key, contentType), key });
}

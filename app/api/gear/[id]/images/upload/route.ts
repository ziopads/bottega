import { NextResponse } from 'next/server';

import { apiAccount, gearRefusal } from '@/lib/access';
import { filesConfigured, signFileUpload } from '@/lib/files';
import { getGear } from '@/lib/gear';
import { FILE_ROLES, type GearFileRole } from '@/lib/gearTypes';
import { newImageFolder, validVariantSet, variantLimit, variantType } from '@/lib/images';
import { formatBytes } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

// POST /api/gear/:id/images/upload   { role, variants: [{ file: 'thumb.webp', bytes }, …] }
// Step 1 of 2 for an image (REQUIREMENTS G-10): signed PUTs for its web
// versions, made in the browser, into a new folder under the unit owner's
// prefix. Photos need contribute access, other roles ownership. The total
// is checked against the owner's storage room, since the files count against
// the owner whoever uploads them. Then POST /api/gear/:id/images.
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
  const role = (body.role ?? 'photo') as GearFileRole;
  if (!FILE_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid file role' }, { status: 400 });
  const variants = Array.isArray(body.variants) ? (body.variants as { file?: unknown; bytes?: unknown }[]) : [];
  const files = variants.map((v) => v.file);
  if (!validVariantSet(files)) return NextResponse.json({ error: 'An image needs its thumb, view and full versions.' }, { status: 400 });
  let total = 0;
  for (const v of variants) {
    const bytes = Number(v.bytes);
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > variantLimit(String(v.file))) {
      return NextResponse.json({ error: `${v.file} is empty or larger than allowed.` }, { status: 400 });
    }
    total += bytes;
  }

  const refusal = await gearRefusal(db, id, role === 'photo' ? 'contribute' : 'owner');
  if (refusal) return refusal;
  const unit = await getGear(db, id);
  if (!unit) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const room = (await db.q('select storage_room($1) as room', [unit.ownerId]))[0]?.room;
  if (room !== null && room !== undefined && Number(room) < total) {
    return NextResponse.json(
      { error: `Not enough storage left on this account (${formatBytes(Number(room))} free).` },
      { status: 413 },
    );
  }

  const folder = newImageFolder(unit.ownerId, id);
  const urls: Record<string, string> = {};
  for (const file of files) urls[file] = await signFileUpload(folder + file, variantType(file));
  return NextResponse.json({ folder, urls });
}

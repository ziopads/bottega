import { NextResponse } from 'next/server';

import { apiAccount, gearRefusal } from '@/lib/access';
import { filesConfigured } from '@/lib/files';
import { addGearFile, getGear } from '@/lib/gear';
import { defaultPublic, FILE_ROLES, type GearFileRole } from '@/lib/gearTypes';
import { checkStoredVariants, isImageFolder, validVariantSet, variantType } from '@/lib/images';

export const dynamic = 'force-dynamic';

const dimension = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 20_000 ? n : null;
};

// POST /api/gear/:id/images   { folder, variants: ['thumb.webp', …], filename, role, width, height }
// Step 2 of 2: record an image whose web versions have reached storage. The
// folder must be one issued for this unit under its owner's prefix; each
// version's size and type are read back from R2, not taken from the browser.
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
  const folder = typeof body.folder === 'string' ? body.folder : '';
  const variants = body.variants;
  if (!validVariantSet(variants)) return NextResponse.json({ error: 'An image needs its thumb, view and full versions.' }, { status: 400 });
  const filename = typeof body.filename === 'string' ? body.filename.trim().slice(0, 255) : '';
  if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });

  const refusal = await gearRefusal(db, id, role === 'photo' ? 'contribute' : 'owner');
  if (refusal) return refusal;
  const unit = await getGear(db, id);
  if (!unit || !isImageFolder(folder, unit.ownerId, id)) return NextResponse.json({ error: 'Invalid upload folder' }, { status: 400 });

  const checked = await checkStoredVariants(folder, variants);
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 409 });

  const full = variants.find((f) => f.startsWith('full.'))!;
  const file = await addGearFile(db, {
    gearId: id,
    role,
    key: folder,
    filename,
    contentType: variantType(full),
    bytes: checked.bytes,
    // A contributor's photo is public, or they could not see it (db/006).
    isPublic: unit.level === 'owner' ? defaultPublic(role) : true,
    variants,
    width: dimension(body.width),
    height: dimension(body.height),
  });
  return NextResponse.json({ file }, { status: 201 });
}

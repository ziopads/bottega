import { NextResponse } from 'next/server';

import { apiAccount, gearRefusal } from '@/lib/access';
import { deleteFile, filesConfigured, signFileUpload } from '@/lib/files';
import { convertGearFile, getGear, getGearFileWithKey } from '@/lib/gear';
import { IMAGE_VARIANTS } from '@/lib/imageTypes';
import { checkStoredVariants, isImageFolder, newImageFolder, validVariantSet, variantLimit, variantType } from '@/lib/images';

export const dynamic = 'force-dynamic';

const dimension = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 20_000 ? n : null;
};

async function load(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  if (!filesConfigured()) return NextResponse.json({ error: 'File storage is not configured yet.' }, { status: 503 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const found = await getGearFileWithKey(account.db, id);
  if (!found) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const refusal = await gearRefusal(account.db, found.file.gearId, 'owner');
  if (refusal) return refusal;
  if (!found.file.needsConversion) return NextResponse.json({ error: 'This image already has its web versions.' }, { status: 409 });
  const unit = await getGear(account.db, found.file.gearId);
  if (!unit) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // an empty body is allowed for the first step
  }
  return { account, id, found, unit, body };
}

// PUT /api/gear-files/:id/convert   { variants: [{ file, bytes }, …] }
// Step 1 of 2 in converting an older image (one stored as its original,
// from before db/007): signed PUTs for its web versions, made in the owner's
// browser from the original. Smaller than the original, so no storage check.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ready = await load(req, ctx);
  if (ready instanceof NextResponse) return ready;
  const { body, unit } = ready;
  const variants = Array.isArray(body.variants) ? (body.variants as { file?: unknown; bytes?: unknown }[]) : [];
  const files = variants.map((v) => v.file);
  if (!validVariantSet(files)) return NextResponse.json({ error: `An image needs ${IMAGE_VARIANTS.length} versions.` }, { status: 400 });
  for (const v of variants) {
    const bytes = Number(v.bytes);
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > variantLimit(String(v.file))) {
      return NextResponse.json({ error: `${v.file} is empty or larger than allowed.` }, { status: 400 });
    }
  }
  const folder = newImageFolder(unit.ownerId, unit.id);
  const urls: Record<string, string> = {};
  for (const file of files) urls[file] = await signFileUpload(folder + file, variantType(file));
  return NextResponse.json({ folder, urls });
}

// POST /api/gear-files/:id/convert   { folder, variants: ['thumb.webp', …], width, height }
// Step 2 of 2: point the row at its new folder, then delete the original.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ready = await load(req, ctx);
  if (ready instanceof NextResponse) return ready;
  const { account, id, found, unit, body } = ready;
  const folder = typeof body.folder === 'string' ? body.folder : '';
  const variants = body.variants;
  if (!validVariantSet(variants)) return NextResponse.json({ error: 'An image needs its thumb, view and full versions.' }, { status: 400 });
  if (!isImageFolder(folder, unit.ownerId, unit.id)) return NextResponse.json({ error: 'Invalid upload folder' }, { status: 400 });

  const checked = await checkStoredVariants(folder, variants);
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 409 });
  const full = variants.find((f) => f.startsWith('full.'))!;
  const file = await convertGearFile(account.db, id, {
    folder,
    variants,
    bytes: checked.bytes,
    contentType: variantType(full),
    width: dimension(body.width) ?? 1,
    height: dimension(body.height) ?? 1,
  });
  if (!file) return NextResponse.json({ error: 'This image could not be converted.' }, { status: 409 });
  try {
    await deleteFile(found.key);
  } catch (err) {
    console.error('[convert] original not deleted', found.key, err);
  }
  return NextResponse.json({ file });
}

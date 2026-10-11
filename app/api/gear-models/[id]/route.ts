import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { getModel, updateModel } from '@/lib/gear';
import { GEAR_CATEGORIES, GEAR_KINDS, parseShortText, type GearCategory, type GearKind, type GearModel } from '@/lib/gearTypes';

export const dynamic = 'force-dynamic';

const STATUSES = ['suggested', 'approved', 'rejected'] as const;

// PATCH /api/gear-models/:id   { status?, kind?, category?, maker?, model?, year?, description? }
// The platform administrator approves, rejects and corrects catalogue models
// (REQUIREMENTS G-6). The database refuses anyone else.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  if (!account.isPlatformAdmin) return NextResponse.json({ error: 'Only the platform administrator edits the catalogue.' }, { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!(await getModel(account.db, id))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const patch: Partial<Pick<GearModel, 'kind' | 'category' | 'maker' | 'model' | 'year' | 'description' | 'status'>> = {};
  if ('status' in body) {
    if (!STATUSES.includes(body.status as (typeof STATUSES)[number])) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    patch.status = body.status as GearModel['status'];
  }
  if ('kind' in body) {
    if (!GEAR_KINDS.includes(body.kind as GearKind)) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    patch.kind = body.kind as GearKind;
  }
  if ('category' in body) {
    if (!GEAR_CATEGORIES.includes(body.category as GearCategory)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    patch.category = body.category as GearCategory;
  }
  for (const field of ['maker', 'model'] as const) {
    if (field in body) {
      const r = parseShortText(body[field], field === 'maker' ? 'Maker' : 'Model');
      if ('error' in r || !r.value) return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
      patch[field] = r.value;
    }
  }
  if ('year' in body) {
    const y = body.year === null || body.year === '' ? null : Number(body.year);
    if (y !== null && (!Number.isInteger(y) || y < 1900 || y > 2200)) return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    patch.year = y;
  }
  if ('description' in body) {
    if (typeof body.description !== 'string') return NextResponse.json({ error: 'Invalid description' }, { status: 400 });
    patch.description = body.description.slice(0, 5_000);
  }
  try {
    return NextResponse.json({ model: await updateModel(account.db, id, patch) });
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      return NextResponse.json({ error: 'Another model already has that maker and name.' }, { status: 409 });
    }
    throw err;
  }
}

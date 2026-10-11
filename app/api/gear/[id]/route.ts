import { NextResponse } from 'next/server';

import { apiAccount, gearRefusal } from '@/lib/access';
import { deleteGear, getGear, getModel, updateGear, type GearPatch } from '@/lib/gear';
import { GEAR_STATUSES, parseShortText, type GearStatus } from '@/lib/gearTypes';
import { deleteGearObjects } from '@/lib/images';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/gear/:id [view]
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const unit = await getGear(account.db, id);
  if (!unit) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ unit });
}

// PATCH /api/gear/:id   { nickname?, status?, firmware?, notes?, modelId?, manufacturer?, name? }
// Nickname, firmware and notes need edit access; what the unit is (model,
// manufacturer, name) and its status need ownership.
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

  const patch: GearPatch = {};
  for (const [field, label, max] of [
    ['nickname', 'Nickname', 200],
    ['firmware', 'Firmware', 200],
    ['manufacturer', 'Manufacturer', 200],
    ['name', 'Name', 200],
  ] as const) {
    if (field in body) {
      const r = parseShortText(body[field], label, max);
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 });
      patch[field] = r.value;
    }
  }
  if ('notes' in body) {
    if (typeof body.notes !== 'string') return NextResponse.json({ error: 'Invalid notes' }, { status: 400 });
    patch.notes = body.notes.slice(0, 10_000);
  }
  if ('status' in body) {
    if (!GEAR_STATUSES.includes(body.status as GearStatus)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    patch.status = body.status as GearStatus;
  }
  if ('modelId' in body) {
    if (body.modelId === null) patch.modelId = null;
    else {
      const m = Number(body.modelId);
      if (!Number.isInteger(m) || !(await getModel(db, m))) {
        return NextResponse.json({ error: 'That model is not in the catalogue.' }, { status: 400 });
      }
      patch.modelId = m;
    }
  }

  const ownerOnly = ['status', 'modelId', 'manufacturer', 'name'].some((f) => f in patch);
  const refusal = await gearRefusal(db, id, ownerOnly ? 'owner' : 'edit');
  if (refusal) return refusal;

  try {
    const unit = await updateGear(db, id, patch);
    return NextResponse.json({ unit });
  } catch (err) {
    // gear's check: a unit needs a model or a name.
    if ((err as { code?: string })?.code === '23514') {
      return NextResponse.json({ error: 'A unit needs a catalogue model or a name.' }, { status: 400 });
    }
    throw err;
  }
}

// DELETE /api/gear/:id — the owner only (REQUIREMENTS AC-7). Its files go too.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await gearRefusal(db, id, 'owner');
  if (refusal) return refusal;
  const objects = await deleteGear(db, id);
  // Rows first, then objects: a failed object delete leaves a harmless orphan
  // under the owner's prefix, never a row pointing at nothing.
  for (const o of objects) {
    try {
      await deleteGearObjects(o.key, o.variants);
    } catch (err) {
      console.error('gear file delete failed', o.key, err);
    }
  }
  return NextResponse.json({ ok: true });
}

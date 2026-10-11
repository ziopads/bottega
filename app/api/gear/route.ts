import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { createGear, getModel, listGear } from '@/lib/gear';
import { GEAR_STATUSES, parseShortText, type GearStatus } from '@/lib/gearTypes';

export const dynamic = 'force-dynamic';

// GET /api/gear — every unit the viewer can see: their own and those shared with them.
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  return NextResponse.json({ gear: await listGear(account.db) });
}

// POST /api/gear   { modelId? | maker + name, nickname?, status? }
// Adds a unit to the viewer's own account: a catalogue model, or a maker and
// name for something not in the catalogue yet.
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  let modelId: number | null = null;
  if (body.modelId !== undefined && body.modelId !== null && body.modelId !== '') {
    modelId = Number(body.modelId);
    if (!Number.isInteger(modelId) || !(await getModel(db, modelId))) {
      return NextResponse.json({ error: 'That model is not in the catalogue.' }, { status: 400 });
    }
  }
  const maker = parseShortText(body.maker, 'Maker');
  const name = parseShortText(body.name, 'Name');
  const nickname = parseShortText(body.nickname, 'Nickname');
  for (const r of [maker, name, nickname]) if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 });
  if (!modelId && !('value' in name && name.value)) {
    return NextResponse.json({ error: 'Choose a model, or give the unit a name.' }, { status: 400 });
  }
  const status = (body.status ?? 'owned') as GearStatus;
  if (!GEAR_STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const unit = await createGear(db, {
    modelId,
    maker: 'value' in maker ? maker.value : '',
    name: 'value' in name ? name.value : '',
    nickname: 'value' in nickname ? nickname.value : '',
    status,
  });
  return NextResponse.json({ unit }, { status: 201 });
}

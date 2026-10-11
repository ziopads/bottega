import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { searchModels, suggestModel } from '@/lib/gear';
import { GEAR_CATEGORIES, GEAR_KINDS, parseShortText, type GearCategory, type GearKind } from '@/lib/gearTypes';

export const dynamic = 'force-dynamic';

// GET /api/gear-models?q=prophet — approved models matching, and the viewer's
// own suggestions, for choosing a unit's model.
export async function GET(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 100);
  return NextResponse.json({ models: await searchModels(account.db, q) });
}

// POST /api/gear-models   { kind, category, maker, model, year? }
// Suggests a model for the catalogue (REQUIREMENTS G-6). It is usable at once
// by whoever suggested it and visible to others once the platform
// administrator approves it; a model the administrator adds is approved.
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const kind = (body.kind ?? 'hardware') as GearKind;
  if (!GEAR_KINDS.includes(kind)) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  const category = (body.category ?? 'other') as GearCategory;
  if (!GEAR_CATEGORIES.includes(category)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  const maker = parseShortText(body.maker, 'Maker');
  const model = parseShortText(body.model, 'Model');
  if ('error' in maker) return NextResponse.json({ error: maker.error }, { status: 400 });
  if ('error' in model) return NextResponse.json({ error: model.error }, { status: 400 });
  if (!maker.value || !model.value) return NextResponse.json({ error: 'Give both a maker and a model.' }, { status: 400 });
  const year = body.year === undefined || body.year === null || body.year === '' ? null : Number(body.year);
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) {
    return NextResponse.json({ error: 'Year must be a four-digit year.' }, { status: 400 });
  }

  const result = await suggestModel(account.db, { kind, category, maker: maker.value, model: model.value, year });
  if (!result.ok) {
    return NextResponse.json(
      { error: 'That model is already in the catalogue.', existing: result.existing },
      { status: 409 },
    );
  }
  return NextResponse.json({ model: result.model }, { status: 201 });
}

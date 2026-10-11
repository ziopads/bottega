import { NextResponse } from 'next/server';

import { apiAccount, gearRefusal } from '@/lib/access';
import { getGearPrivate, updateGearPrivate } from '@/lib/gear';
import type { GearPrivate } from '@/lib/gearTypes';

export const dynamic = 'force-dynamic';

// The unit's insurance record (REQUIREMENTS G-2, G-7): the owner only, at
// every share level. The database returns no row to anyone else; the route
// refuses first so the answer is clear.

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const TEXT: [keyof GearPrivate, number][] = [
  ['serial', 200],
  ['purchasedFrom', 200],
  ['condition', 200],
  ['location', 200],
  ['serviceHistory', 10_000],
  ['licenseKey', 2_000],
  ['licenseActivation', 500],
];
const DATES: (keyof GearPrivate)[] = ['purchaseDate', 'licenseRenewal', 'valuedOn'];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await gearRefusal(account.db, id, 'owner');
  if (refusal) return refusal;
  return NextResponse.json({ record: await getGearPrivate(account.db, id) });
}

// PATCH /api/gear/:id/private   { serial?, purchaseDate?, purchasePrice?, currency?, … }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await gearRefusal(db, id, 'owner');
  if (refusal) return refusal;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const patch: Partial<GearPrivate> = {};
  for (const [field, max] of TEXT) {
    if (field in body) {
      if (typeof body[field] !== 'string') return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
      (patch as Record<string, unknown>)[field] = (body[field] as string).trim().slice(0, max);
    }
  }
  for (const field of DATES) {
    if (field in body) {
      const v = body[field];
      if (v === null || v === '') (patch as Record<string, unknown>)[field] = null;
      else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) (patch as Record<string, unknown>)[field] = v;
      else return NextResponse.json({ error: 'Dates are YYYY-MM-DD.' }, { status: 400 });
    }
  }
  for (const field of ['purchasePrice', 'estimatedValue'] as const) {
    if (field in body) {
      const v = body[field];
      if (v === null || v === '') patch[field] = null;
      else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Amounts must be positive numbers.' }, { status: 400 });
        patch[field] = Math.round(n * 100) / 100;
      }
    }
  }
  if ('currency' in body) {
    const c = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(c)) return NextResponse.json({ error: 'Currency is a three-letter code, like USD.' }, { status: 400 });
    patch.currency = c;
  }
  if ('licenseSeats' in body) {
    const v = body.licenseSeats;
    if (v === null || v === '') patch.licenseSeats = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: 'Seats is a whole number.' }, { status: 400 });
      patch.licenseSeats = n;
    }
  }
  return NextResponse.json({ record: await updateGearPrivate(db, id, patch) });
}

import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { deleteVariant, parseVariantInput, renameVariant } from '@/lib/variants';

export const dynamic = 'force-dynamic';

// One variant of a session (db/015): renamed with its mixes and saves by edit
// access; removed by the owner while it has no mixes.

type Ctx = { params: Promise<{ id: string; variantId: string }> };

function parseIds(p: { id: string; variantId: string }): [number, number] | null {
  const a = Number(p.id);
  const b = Number(p.variantId);
  return Number.isInteger(a) && a > 0 && Number.isInteger(b) && b > 0 ? [a, b] : null;
}

// PATCH /api/projects/:id/variants/:variantId   { name, match? }
export async function PATCH(req: Request, ctx: Ctx) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const ids = parseIds(await ctx.params);
  if (!ids) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(account.db, ids[0], 'edit');
  if (refusal) return refusal;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const input = parseVariantInput(body?.name, body?.match);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const r = await renameVariant(account.db, ids[0], ids[1], input.name, input.match);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ variants: r.variants });
}

// DELETE /api/projects/:id/variants/:variantId
export async function DELETE(_req: Request, ctx: Ctx) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const ids = parseIds(await ctx.params);
  if (!ids) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(account.db, ids[0], 'owner');
  if (refusal) return refusal;
  const r = await deleteVariant(account.db, ids[0], ids[1]);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ variants: r.variants });
}

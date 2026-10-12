import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { createVariant, listVariants, parseVariantInput } from '@/lib/variants';

export const dynamic = 'force-dynamic';

// A session's variants beside the main mix (REQUIREMENTS S-14, S-16; db/015).

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/projects/:id/variants
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(account.db, id, 'view');
  if (refusal) return refusal;
  return NextResponse.json({ variants: await listVariants(account.db, id) });
}

// POST /api/projects/:id/variants   { name, match? }   edit access
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(account.db, id, 'edit');
  if (refusal) return refusal;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const input = parseVariantInput(body?.name, body?.match);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const r = await createVariant(account.db, id, input.name, input.match);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ variants: r.variants }, { status: 201 });
}

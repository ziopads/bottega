import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { moveSave } from '@/lib/variants';

export const dynamic = 'force-dynamic';

// PATCH /api/projects/:id/als/:snapshotId   { variant: string | null }
// Puts a saved set in a variant by hand ('' is the main mix), or with null
// hands it back to the variants' name rules (db/015). Edit access.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; snapshotId: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const p = await ctx.params;
  const id = Number(p.id);
  const snapshotId = Number(p.snapshotId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(snapshotId) || snapshotId <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const refusal = await projectRefusal(account.db, id, 'edit');
  if (refusal) return refusal;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const variant = body?.variant === null ? null : typeof body?.variant === 'string' ? body.variant.trim() : undefined;
  if (variant === undefined) return NextResponse.json({ error: 'Say which variant, or null for the name rules.' }, { status: 400 });
  const r = await moveSave(account.db, id, snapshotId, variant);
  if (r === 'not-found') return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (r === 'unknown-variant') return NextResponse.json({ error: 'This session has no variant by that name.' }, { status: 400 });
  return NextResponse.json({ ok: true });
}

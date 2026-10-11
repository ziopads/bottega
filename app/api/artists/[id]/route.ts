import { NextResponse } from 'next/server';

import { deleteArtist, normalizeArtist, updateArtist } from '@/lib/account';
import { apiAccount } from '@/lib/access';

export const dynamic = 'force-dynamic';

// One of the signed-in person's artists: rename it, or delete it when no
// session or release is credited to it (REQUIREMENTS AC-13).

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// PATCH /api/artists/:id   { code, name }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const input = normalizeArtist(body.code, body.name);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const result = await updateArtist(account.db, id, input.code, input.name);
  if (!result.ok) {
    return result.reason === 'taken'
      ? NextResponse.json({ error: 'That code or name is already in use.' }, { status: 409 })
      : NextResponse.json({ error: 'Artist not found' }, { status: 404 });
  }
  return NextResponse.json({ artist: result.artist });
}

// DELETE /api/artists/:id
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const result = await deleteArtist(account.db, id);
  if (!result.ok) {
    return result.reason === 'in-use'
      ? NextResponse.json({ error: 'Sessions or releases are credited to this artist; move them first.' }, { status: 409 })
      : NextResponse.json({ error: 'Artist not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';

import { createArtist, normalizeArtist } from '@/lib/account';
import { apiAccount } from '@/lib/access';

export const dynamic = 'force-dynamic';

// The signed-in person's artists (REQUIREMENTS AC-13). Codes and names are
// unique across Bottega; the database sets the account.

// POST /api/artists   { code, name }
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const input = normalizeArtist(body.code, body.name);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const result = await createArtist(account.db, input.code, input.name);
  if (!result.ok) return NextResponse.json({ error: 'That code or name is already in use.' }, { status: 409 });
  return NextResponse.json({ artist: result.artist }, { status: 201 });
}

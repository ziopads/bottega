import { NextResponse } from 'next/server';

import { setDefaultArtist } from '@/lib/account';
import { apiAccount } from '@/lib/access';

export const dynamic = 'force-dynamic';

// The signed-in person's preferences (REQUIREMENTS AC-13, db/010).

// PUT /api/account/preferences   { defaultArtistId: number | null }
export async function PUT(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const raw = body.defaultArtistId;
  const artistId = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (artistId !== null && !(Number.isInteger(artistId) && artistId > 0)) {
    return NextResponse.json({ error: 'Invalid artist' }, { status: 400 });
  }
  const result = await setDefaultArtist(account.db, artistId);
  if (!result.ok) return NextResponse.json({ error: 'Choose one of your own artists.' }, { status: 400 });
  return NextResponse.json({ preferences: result.preferences });
}

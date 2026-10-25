import { NextResponse } from 'next/server';

import { setDefaultArtist, setLook, setProjectColumns } from '@/lib/account';
import { isProjectColumn } from '@/lib/projectColumns';
import { apiAccount } from '@/lib/access';
import { isMode, isTheme } from '@/lib/theme';

export const dynamic = 'force-dynamic';

// The signed-in person's preferences (REQUIREMENTS AC-13, db/010).

// PUT /api/account/preferences   { defaultArtistId: number | null }
//                                 or { theme?, mode? }   (db/030)
//                                 or { projectColumns: string[] | null }   (db/033)
export async function PUT(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if ('projectColumns' in body) {
    const raw = body.projectColumns;
    if (raw !== null && !(Array.isArray(raw) && raw.length > 0 && raw.length <= 20 && raw.every(isProjectColumn) && new Set(raw).size === raw.length)) {
      return NextResponse.json({ error: 'Choose columns from the list' }, { status: 400 });
    }
    await setProjectColumns(account.db, raw);
    return NextResponse.json({ ok: true });
  }
  if ('theme' in body || 'mode' in body) {
    if (body.theme !== undefined && !isTheme(body.theme)) return NextResponse.json({ error: 'Unknown theme' }, { status: 400 });
    if (body.mode !== undefined && !isMode(body.mode)) return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
    const look = await setLook(account.db, { theme: body.theme as never, mode: body.mode as never });
    return NextResponse.json({ look });
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

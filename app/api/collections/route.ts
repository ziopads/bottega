import { NextResponse } from 'next/server';
import { apiAccount } from '@/lib/access';
import { createRelease, listReleases } from '@/lib/studio';
import { RELEASE_KINDS, parseReleaseTitle, type ReleaseKind } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  return NextResponse.json({ releases: await listReleases(db) });
}

// POST /api/collections   { title, kind?, artistId?, year? }
// Creates a collection in the signed-in person's own account; artistId, when
// given, must be one of their own artists.
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
  const title = parseReleaseTitle(body.title);
  if ('error' in title) return NextResponse.json({ error: title.error }, { status: 400 });
  const kind = (body.kind ?? 'lp') as ReleaseKind;
  if (!RELEASE_KINDS.includes(kind)) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  const artistId = body.artistId === null || body.artistId === undefined || body.artistId === '' ? null : Number(body.artistId);
  if (artistId !== null && !Number.isInteger(artistId)) return NextResponse.json({ error: 'Invalid artist' }, { status: 400 });
  const year = body.year === null || body.year === undefined || body.year === '' ? null : Number(body.year);
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) {
    return NextResponse.json({ error: 'Year must be a four-digit year.' }, { status: 400 });
  }
  try {
    const release = await createRelease(db, { title: title.value, kind, artistId, year, by: account.email });
    return NextResponse.json({ release }, { status: 201 });
  } catch (err) {
    if (/belongs to another account/.test(String((err as Error)?.message))) {
      return NextResponse.json({ error: 'Choose one of your own artists.' }, { status: 400 });
    }
    throw err;
  }
}

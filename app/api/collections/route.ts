import { NextResponse } from 'next/server';
import { createRelease, getStudioViewer, listReleases } from '@/lib/studio';
import { RELEASE_KINDS, parseReleaseTitle, type ReleaseKind } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

export async function GET() {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return NextResponse.json({ releases: await listReleases() });
}

// POST /api/collections   { title, kind?, artistId?, year? } — any studio member.
export async function POST(req: Request) {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const title = parseReleaseTitle(body.title);
  if ('error' in title) return NextResponse.json({ error: title.error }, { status: 400 });
  const kind = (body.kind ?? 'album') as ReleaseKind;
  if (!RELEASE_KINDS.includes(kind)) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  const artistId = body.artistId === null || body.artistId === undefined || body.artistId === '' ? null : Number(body.artistId);
  if (artistId !== null && !Number.isInteger(artistId)) return NextResponse.json({ error: 'Invalid artist' }, { status: 400 });
  const year = body.year === null || body.year === undefined || body.year === '' ? null : Number(body.year);
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) {
    return NextResponse.json({ error: 'Year must be a four-digit year.' }, { status: 400 });
  }
  const release = await createRelease({ title: title.value, kind, artistId, year, by: viewer.email });
  return NextResponse.json({ release }, { status: 201 });
}

import { NextResponse } from 'next/server';
import { apiAccount, atLeast, projectLevel } from '@/lib/access';
import { addToRelease, bulkUpdateProjects, getRelease } from '@/lib/studio';
import { parseBpm, parseGenre, parseRating } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

const MAX_IDS = 1000;

// POST /api/projects/bulk
//   { ids: number[], genre?, bpm?, rating?, artistId?, releaseId? }
// The fields present are set on every listed session, which needs edit access
// or ownership on each (moving to another artist needs ownership); releaseId
// appends them to that collection's running order, which needs edit access on
// the collection.
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
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (!ids.length) return NextResponse.json({ error: 'Select at least one session.' }, { status: 400 });
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `At most ${MAX_IDS} at a time.` }, { status: 400 });

  const levels = await Promise.all(ids.map((id) => projectLevel(db, id)));
  if (levels.some((l) => l === null)) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });

  const patch: { genre?: string; bpm?: number | null; rating?: number; artistId?: number } = {};
  if ('genre' in body) {
    const g = parseGenre(body.genre);
    if ('error' in g) return NextResponse.json({ error: g.error }, { status: 400 });
    patch.genre = g.value;
  }
  if ('bpm' in body) {
    const b = parseBpm(body.bpm);
    if ('error' in b) return NextResponse.json({ error: b.error }, { status: 400 });
    patch.bpm = b.value;
  }
  if ('rating' in body) {
    const r = parseRating(body.rating);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 });
    patch.rating = r.value;
  }
  if ('artistId' in body) {
    const a = Number(body.artistId);
    if (!Number.isInteger(a)) return NextResponse.json({ error: 'Invalid artist' }, { status: 400 });
    patch.artistId = a;
  }

  const needed = patch.artistId !== undefined ? 'owner' : 'edit';
  if (Object.keys(patch).length && levels.some((l) => !atLeast(l, needed))) {
    return NextResponse.json(
      { error: needed === 'owner' ? 'Only the owner can move a session to another artist.' : 'Some of these sessions are shared with you without edit access.' },
      { status: 403 },
    );
  }

  const result = await bulkUpdateProjects(db, ids, patch);
  if (!result.ok) {
    const msg =
      result.reason === 'taken'
        ? 'That artist already has a session with one of these canonical IDs, so nothing was moved.'
        : result.reason === 'no-genre'
          ? 'That genre is not on the list.'
          : 'Choose one of your own artists.';
    return NextResponse.json({ error: msg }, { status: result.reason === 'taken' ? 409 : 400 });
  }

  if (body.releaseId !== undefined && body.releaseId !== null && body.releaseId !== '') {
    const releaseId = Number(body.releaseId);
    const release = Number.isInteger(releaseId) ? await getRelease(db, releaseId) : null;
    if (!release) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    if (!atLeast(release.level, 'edit')) {
      return NextResponse.json({ error: 'That collection is shared with you without edit access.' }, { status: 403 });
    }
    await addToRelease(db, releaseId, ids);
  }

  return NextResponse.json({ projects: result.projects });
}

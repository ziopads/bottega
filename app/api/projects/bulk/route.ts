import { NextResponse } from 'next/server';
import { addToRelease, bulkUpdateProjects, getRelease, getStudioViewer } from '@/lib/studio';
import { parseBpm, parseGenre, parseRating } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

const MAX_IDS = 1000;

// POST /api/projects/bulk
//   { ids: number[], genre?, bpm?, rating?, artistId?, releaseId? }
// Any studio member. The fields present are set on every listed session;
// releaseId appends them to that release's running order (in the order given).
export async function POST(req: Request) {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (!ids.length) return NextResponse.json({ error: 'Select at least one session.' }, { status: 400 });
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `At most ${MAX_IDS} at a time.` }, { status: 400 });

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

  const result = await bulkUpdateProjects(ids, patch);
  if (!result.ok) {
    const msg =
      result.reason === 'taken'
        ? 'That artist already has a session with one of these canonical IDs, so nothing was moved.'
        : result.reason === 'no-genre'
          ? 'That genre is not on the list.'
          : 'That artist is not on the roster.';
    return NextResponse.json({ error: msg }, { status: result.reason === 'taken' ? 409 : 400 });
  }

  if (body.releaseId !== undefined && body.releaseId !== null && body.releaseId !== '') {
    const releaseId = Number(body.releaseId);
    if (!Number.isInteger(releaseId) || !(await getRelease(releaseId))) {
      return NextResponse.json({ error: 'Release not found' }, { status: 404 });
    }
    await addToRelease(releaseId, ids);
  }

  return NextResponse.json({ projects: result.projects });
}

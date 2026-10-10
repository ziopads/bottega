import { NextResponse } from 'next/server';
import { getProject, getStudioViewer, updateProject } from '@/lib/studio';
import { parseBpm, parseGenre, parseRating, parseWorkingName } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/projects/:id
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  return NextResponse.json({ project });
}

// PATCH /api/projects/:id   { workingName?, rating?, genre?, bpm?, artistId?, currentMixId? }
// Any studio member. The canonical ID is permanent, so a body that tries to set
// it is refused outright rather than having that key quietly ignored.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if ('canonicalId' in body || 'canonical_id' in body) {
    return NextResponse.json(
      { error: 'The canonical ID is permanent: it matches the Ableton folder and cannot be changed.' },
      { status: 400 },
    );
  }

  const patch: {
    workingName?: string;
    rating?: number;
    genre?: string;
    bpm?: number | null;
    artistId?: number;
    currentMixId?: number | null;
  } = {};
  if ('workingName' in body) {
    const name = parseWorkingName(body.workingName);
    if ('error' in name) return NextResponse.json({ error: name.error }, { status: 400 });
    patch.workingName = name.value;
  }
  if ('rating' in body) {
    const rating = parseRating(body.rating);
    if ('error' in rating) return NextResponse.json({ error: rating.error }, { status: 400 });
    patch.rating = rating.value;
  }
  if ('genre' in body) {
    const genre = parseGenre(body.genre);
    if ('error' in genre) return NextResponse.json({ error: genre.error }, { status: 400 });
    patch.genre = genre.value;
  }
  if ('bpm' in body) {
    const bpm = parseBpm(body.bpm);
    if ('error' in bpm) return NextResponse.json({ error: bpm.error }, { status: 400 });
    patch.bpm = bpm.value;
  }
  if ('artistId' in body) {
    const artistId = Number(body.artistId);
    if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'Invalid artist' }, { status: 400 });
    patch.artistId = artistId;
  }

  // currentMixId: a mix of this project to make current, or null for "the newest".
  if ('currentMixId' in body) {
    if (body.currentMixId === null) patch.currentMixId = null;
    else {
      const mix = Number(body.currentMixId);
      if (!Number.isInteger(mix) || mix <= 0) return NextResponse.json({ error: 'Invalid mix' }, { status: 400 });
      patch.currentMixId = mix;
    }
  }

  const result = await updateProject(id, patch, viewer.email);
  if (!result.ok) {
    if (result.reason === 'not-found') return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (result.reason === 'no-artist') return NextResponse.json({ error: 'That artist is not on the roster.' }, { status: 400 });
    if (result.reason === 'bad-mix') return NextResponse.json({ error: 'That mix is not part of this session.' }, { status: 400 });
    if (result.reason === 'no-genre') return NextResponse.json({ error: 'That genre is not on the list. Add it first.' }, { status: 400 });
    return NextResponse.json(
      { error: 'That artist already has a project with this canonical ID.' },
      { status: 409 },
    );
  }
  return NextResponse.json({ project: result.project });
}

import { NextResponse } from 'next/server';
import { addTrack, getProject, getStudioViewer, listTracks } from '@/lib/studio';
import { audioConfigured, audioObjectSize, isKeyForProject } from '@/lib/studioAudio';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/projects/:id/tracks — newest version first.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  return NextResponse.json({ tracks: await listTracks(id) });
}

// POST /api/projects/:id/tracks   { key, filename, durationS? }
// Step 2 of 2: record an upload that has reached R2 as the next version.
// The key must be one this project was issued, and the object must exist;
// its size is read from R2 rather than trusted from the browser.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!audioConfigured()) {
    return NextResponse.json({ error: 'Audio storage is not configured yet (R2_AUDIO_BUCKET).' }, { status: 503 });
  }
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const key = typeof body.key === 'string' ? body.key : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim().slice(0, 255) : '';
  const duration = Number(body.durationS);
  const durationS = Number.isFinite(duration) && duration > 0 ? duration : null;

  if (!isKeyForProject(key, id)) return NextResponse.json({ error: 'Invalid upload key' }, { status: 400 });
  if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
  if (!(await getProject(id))) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const bytes = await audioObjectSize(key);
  if (bytes === null) {
    return NextResponse.json({ error: 'The upload did not reach storage. Please try again.' }, { status: 409 });
  }

  const track = await addTrack({ projectId: id, key, originalFilename: filename, bytes, durationS, by: viewer.email });
  return NextResponse.json({ track }, { status: 201 });
}

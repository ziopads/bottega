import { NextResponse } from 'next/server';

import { addReference, getProject, getStudioViewer, listReferences } from '@/lib/studio';
import { audioConfigured, audioObjectSize, isKeyForProject } from '@/lib/studioAudio';
import { parseCredit } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/projects/:id/references — oldest first.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  return NextResponse.json({ references: await listReferences(id) });
}

// POST /api/projects/:id/references   { key, filename, durationS?, credit? }
// Records a reference track (another artist's) that has reached R2. The file
// goes up through the same signed PUT as a mix (…/tracks/upload); only this
// last step differs. Any studio member.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!audioConfigured()) {
    return NextResponse.json({ error: 'Audio storage is not configured yet (R2_AUDIO_BUCKET).' }, { status: 503 });
  }
  const id = parseId((await ctx.params).id);
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
  const credit = parseCredit(body.credit);
  if ('error' in credit) return NextResponse.json({ error: credit.error }, { status: 400 });

  if (!isKeyForProject(key, id)) return NextResponse.json({ error: 'Invalid upload key' }, { status: 400 });
  if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
  if (!(await getProject(id))) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const bytes = await audioObjectSize(key);
  if (bytes === null) {
    return NextResponse.json({ error: 'The upload did not reach storage. Please try again.' }, { status: 409 });
  }

  const reference = await addReference({
    projectId: id,
    key,
    originalFilename: filename,
    bytes,
    durationS,
    credit: credit.value,
    by: viewer.email,
  });
  return NextResponse.json({ reference }, { status: 201 });
}

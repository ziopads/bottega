import { NextResponse } from 'next/server';
import { apiAccount, projectRefusal } from '@/lib/access';
import { addTrack, getProject, listTracks } from '@/lib/studio';
import { parseVariant } from '@/lib/studioTypes';
import { audioConfigured, audioObjectSize, isKeyForProject } from '@/lib/studioAudio';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/projects/:id/tracks — newest version first.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(db, id, 'view');
  if (refusal) return refusal;
  return NextResponse.json({ tracks: await listTracks(db, id) });
}

// POST /api/projects/:id/tracks   { key, filename, durationS?, variant? }
// Step 2 of 2: record an upload that has reached R2 as the next version of
// its variant ('' or absent: the main mix; db/013), which must be one of the
// session's variants (db/015).
// Needs contribute access or above.
// The key must be one this project was issued, and the object must exist;
// its size is read from R2 rather than trusted from the browser.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
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

  if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
  const variant = parseVariant(body.variant);
  if ('error' in variant) return NextResponse.json({ error: variant.error }, { status: 400 });
  const refusal = await projectRefusal(db, id, 'contribute');
  if (refusal) return refusal;
  const project = await getProject(db, id);
  if (!project || !isKeyForProject(key, id, project.ownerId)) {
    return NextResponse.json({ error: 'Invalid upload key' }, { status: 400 });
  }

  const bytes = await audioObjectSize(key);
  if (bytes === null) {
    return NextResponse.json({ error: 'The upload did not reach storage. Please try again.' }, { status: 409 });
  }

  try {
    const track = await addTrack(db, { projectId: id, variant: variant.value, key, originalFilename: filename, bytes, durationS, by: account.email });
    return NextResponse.json({ track }, { status: 201 });
  } catch (err) {
    // db/015: a mix's variant must be one of the session's.
    if ((err as { code?: string })?.code === '23503') {
      return NextResponse.json({ error: `This session has no variant called “${variant.value}”. Add it above the tabs first.` }, { status: 400 });
    }
    throw err;
  }
}

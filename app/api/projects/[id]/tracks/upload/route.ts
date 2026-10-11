import { NextResponse } from 'next/server';
import { apiAccount, projectRefusal } from '@/lib/access';
import { getProject } from '@/lib/studio';
import { AUDIO_MAX_BYTES, audioConfigured, newAudioKey, signAudioUpload } from '@/lib/studioAudio';

export const dynamic = 'force-dynamic';

// POST /api/projects/:id/tracks/upload   { filename, bytes }
// Step 1 of 2. Returns a signed PUT URL and the key it writes to. The browser
// uploads the file there directly, then records it with
// POST /api/projects/:id/tracks (or /references). Needs contribute access or
// above.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  if (!audioConfigured()) {
    return NextResponse.json({ error: 'Audio storage is not configured yet (R2_AUDIO_BUCKET).' }, { status: 503 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const bytes = Number(body.bytes);
  if (!/\.mp3$/i.test(filename)) return NextResponse.json({ error: 'Only MP3 files can be uploaded.' }, { status: 400 });
  if (!Number.isFinite(bytes) || bytes <= 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
  if (bytes > AUDIO_MAX_BYTES) {
    return NextResponse.json({ error: `The file is over ${AUDIO_MAX_BYTES / (1024 * 1024)} MB.` }, { status: 400 });
  }

  const refusal = await projectRefusal(db, id, 'contribute');
  if (refusal) return refusal;

  const project = await getProject(db, id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const key = newAudioKey(project.ownerId, id);
  return NextResponse.json({ url: await signAudioUpload(key), key });
}

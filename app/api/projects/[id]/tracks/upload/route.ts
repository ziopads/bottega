import { NextResponse } from 'next/server';
import { getProject, getStudioViewer } from '@/lib/studio';
import { AUDIO_MAX_BYTES, audioConfigured, newAudioKey, signAudioUpload } from '@/lib/studioAudio';

export const dynamic = 'force-dynamic';

// POST /api/projects/:id/tracks/upload   { filename, bytes }
// Step 1 of 2. Returns a signed PUT URL and the key it writes to. The browser
// uploads the file there directly, then records it with
// POST /api/projects/:id/tracks. Any studio member.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
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

  if (!(await getProject(id))) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const key = newAudioKey(id);
  return NextResponse.json({ url: await signAudioUpload(key), key });
}

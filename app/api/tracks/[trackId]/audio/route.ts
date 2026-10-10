import { NextResponse } from 'next/server';
import { getAudioWithKey, getProject, getStudioViewer } from '@/lib/studio';
import { audioConfigured, signAudioGet } from '@/lib/studioAudio';
import { downloadName, referenceDownloadName } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

// GET /api/tracks/:trackId/audio            → stream (for <audio>)
// GET /api/tracks/:trackId/audio?download=1 → save as "VIG 2026 0926 — Name — v3.mp3"
//
// Checks the session, then redirects to a short-lived signed R2 link. The
// audio never passes through the app, and the link is minted per request, so
// a copied URL to this route is useless to anyone without a studio session.
export async function GET(req: Request, ctx: { params: Promise<{ trackId: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!audioConfigured()) return NextResponse.json({ error: 'Audio storage is not configured yet.' }, { status: 503 });

  const id = Number(params.trackId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  // Mixes and references alike: both live in the private audio bucket.
  const found = await getAudioWithKey(id);
  if (!found) return NextResponse.json({ error: 'Track not found' }, { status: 404 });

  let name: string | undefined;
  if (new URL(req.url).searchParams.get('download')) {
    if (found.role === 'reference') name = referenceDownloadName(found);
    else {
      const project = await getProject(found.projectId);
      name = project && found.version ? downloadName(project, found.version) : found.originalFilename;
    }
  }

  const res = NextResponse.redirect(await signAudioGet(found.key, name), 302);
  // The signed URL expires, so neither the browser nor Vercel may keep the redirect.
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

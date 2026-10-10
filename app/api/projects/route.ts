import { NextResponse } from 'next/server';
import {
  createProject,
  getMemberArtistId,
  getStudioViewer,
  listArtists,
  listProjects,
} from '@/lib/studio';
import { parseCanonicalId, parseWorkingName } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

// GET /api/projects
// Every project (highest rated first, then newest) and the roster.
export async function GET() {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const [projects, artists] = await Promise.all([listProjects(), listArtists()]);
  return NextResponse.json({ projects, artists });
}

// POST /api/projects   { canonicalId, workingName?, artistId? }
// Any studio member may create a project, for any artist on the roster. With no
// artistId, the project goes to the artist the creator is listed as.
export async function POST(req: Request) {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const canonical = parseCanonicalId(body.canonicalId);
  if ('error' in canonical) return NextResponse.json({ error: canonical.error }, { status: 400 });
  const name = parseWorkingName(body.workingName);
  if ('error' in name) return NextResponse.json({ error: name.error }, { status: 400 });

  let artistId: number | null = null;
  if (body.artistId !== undefined && body.artistId !== null && body.artistId !== '') {
    artistId = Number(body.artistId);
    if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'Invalid artist' }, { status: 400 });
  } else {
    artistId = await getMemberArtistId(viewer.email);
  }
  if (artistId === null) return NextResponse.json({ error: 'Choose an artist.' }, { status: 400 });

  const result = await createProject({
    artistId,
    canonicalId: canonical.value,
    workingName: name.value,
    by: viewer.email,
  });

  if (!result.ok) {
    if (result.reason === 'no-artist') return NextResponse.json({ error: 'That artist is not on the roster.' }, { status: 400 });
    return NextResponse.json(
      {
        error: `This artist already has a project called “${canonical.value}”.`,
        suggestion: result.suggestion,
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ project: result.project }, { status: 201 });
}

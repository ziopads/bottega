import { NextResponse } from 'next/server';
import { apiAccount } from '@/lib/access';
import { createProject, listArtists, listProjects } from '@/lib/studio';
import { parseCanonicalId, parseWorkingName } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

// GET /api/projects
// Every project the viewer can see (their own and those shared with them) and
// the artists that appear on them.
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const [projects, artists] = await Promise.all([listProjects(db), listArtists(db)]);
  return NextResponse.json({ projects, artists });
}

// POST /api/projects   { canonicalId, workingName?, artistId? }
// Creates a project in the signed-in person's own account, credited to one of
// their own artists. With no artistId, their first artist; the database
// refuses another account's artist.
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

  const canonical = parseCanonicalId(body.canonicalId);
  if ('error' in canonical) return NextResponse.json({ error: canonical.error }, { status: 400 });
  const name = parseWorkingName(body.workingName);
  if ('error' in name) return NextResponse.json({ error: name.error }, { status: 400 });

  let artistId: number | null = null;
  if (body.artistId !== undefined && body.artistId !== null && body.artistId !== '') {
    artistId = Number(body.artistId);
    if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'Invalid artist' }, { status: 400 });
  } else {
    artistId = (await listArtists(db)).find((a) => a.mine)?.id ?? null;
  }
  if (artistId === null) {
    return NextResponse.json({ error: 'Your account has no artist yet. Add one first.' }, { status: 400 });
  }

  const result = await createProject(db, {
    artistId,
    canonicalId: canonical.value,
    workingName: name.value,
    by: account.email,
  });

  if (!result.ok) {
    if (result.reason === 'no-artist') return NextResponse.json({ error: 'Choose one of your own artists.' }, { status: 400 });
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

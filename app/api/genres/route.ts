import { NextResponse } from 'next/server';
import { addGenre, getStudioViewer, listGenres } from '@/lib/studio';
import { parseGenre } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

// GET /api/genres — the list, alphabetical.
export async function GET() {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return NextResponse.json({ genres: await listGenres() });
}

// POST /api/genres   { name }
// Any studio member. Returns the stored spelling, which is the existing one
// when the name matches a genre already on the list, ignoring case.
export async function POST(req: Request) {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const parsed = parseGenre(body.name);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.value) return NextResponse.json({ error: 'Enter a genre name.' }, { status: 400 });
  const name = await addGenre(parsed.value);
  return NextResponse.json({ name, genres: await listGenres() }, { status: 201 });
}

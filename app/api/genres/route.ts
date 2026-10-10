import { NextResponse } from 'next/server';
import { apiAccount } from '@/lib/access';
import { addGenre, listGenres } from '@/lib/studio';
import { parseGenre } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

// GET /api/genres — the list, alphabetical.
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  return NextResponse.json({ genres: await listGenres(db) });
}

// POST /api/genres   { name }
// Any active account: genres are one list for the platform. Returns the stored spelling, which is the existing one
// when the name matches a genre already on the list, ignoring case.
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
  const parsed = parseGenre(body.name);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.value) return NextResponse.json({ error: 'Enter a genre name.' }, { status: 400 });
  const name = await addGenre(db, parsed.value);
  return NextResponse.json({ name, genres: await listGenres(db) }, { status: 201 });
}

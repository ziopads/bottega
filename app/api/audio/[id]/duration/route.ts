import { NextResponse } from 'next/server';

import { fillDuration, getStudioViewer } from '@/lib/studio';

export const dynamic = 'force-dynamic';

// POST /api/audio/:id/duration   { durationS }
// Fills in a length the database does not have yet, measured by the browser
// from the file's metadata (as uploads already are). Never overwrites a stored
// length. Used by players when they load a file with no length on record, and
// by the backfill page.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const d = Number(body.durationS);
  // Twelve hours is longer than any session bounce; anything past it is a bad reading.
  if (!Number.isFinite(d) || d <= 0 || d > 12 * 3600) {
    return NextResponse.json({ error: 'Invalid duration' }, { status: 400 });
  }
  return NextResponse.json({ filled: await fillDuration(id, d) });
}

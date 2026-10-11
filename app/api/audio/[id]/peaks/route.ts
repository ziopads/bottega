import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { fillPeaks } from '@/lib/studio';

export const dynamic = 'force-dynamic';

// POST /api/audio/:id/peaks   { peaks: number[] }
// Stores a file's waveform (db/009), measured by the browser, unless it has
// one already. Like lengths: the database stores it only where the signed-in
// person may contribute, and otherwise reports nothing stored.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const peaks = body.peaks;
  if (
    !Array.isArray(peaks) ||
    peaks.length < 1 ||
    peaks.length > 2000 ||
    !peaks.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)
  ) {
    return NextResponse.json({ error: 'A waveform is 1 to 2000 whole numbers from 0 to 255.' }, { status: 400 });
  }
  return NextResponse.json({ stored: await fillPeaks(account.db, id, peaks as number[]) });
}

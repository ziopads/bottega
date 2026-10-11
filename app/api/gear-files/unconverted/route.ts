import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { listUnconvertedImages } from '@/lib/gear';

export const dynamic = 'force-dynamic';

// GET /api/gear-files/unconverted — the signed-in person's own images still
// stored as originals (from before db/007), for the account page's converter.
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  return NextResponse.json({ images: await listUnconvertedImages(account.db) });
}

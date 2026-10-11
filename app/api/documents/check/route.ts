import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { fingerprintMatch } from '@/lib/documents';
import { isSha256 } from '@/lib/documentTypes';

export const dynamic = 'force-dynamic';

// POST /api/documents/check   { sha256 }
// Before uploading: does the library, or the person's own documents, already
// hold this file (REQUIREMENTS K-8)? Answers by fingerprint only; a library
// submission still under review is reported without being shown.
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!isSha256(body.sha256)) return NextResponse.json({ error: 'Missing fingerprint' }, { status: 400 });
  return NextResponse.json({ match: await fingerprintMatch(account.db, body.sha256) });
}

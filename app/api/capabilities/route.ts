import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { listCapabilityDefs } from '@/lib/gear';

export const dynamic = 'force-dynamic';

// GET /api/capabilities — the platform's capability vocabulary.
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  return NextResponse.json({ capabilities: await listCapabilityDefs(account.db) });
}

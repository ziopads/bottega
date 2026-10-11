import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { revokeConnection } from '@/lib/connections';

export const dynamic = 'force-dynamic';

// DELETE /api/account/connections   { clientId }  (null or absent: every client)
// Ends a connector's access for the signed-in person; db/012 logs it.
export async function DELETE(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  let clientId: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.clientId === 'string' && body.clientId) clientId = body.clientId;
  } catch {
    // no body: every client
  }
  return NextResponse.json({ revoked: await revokeConnection(account.db, clientId) });
}

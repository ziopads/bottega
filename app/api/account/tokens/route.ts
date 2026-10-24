import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { createToken, listTokens, revokeToken, TokenError } from '@/lib/tokens';
import { text } from '@/lib/workflowInput';
import { bad, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// The person's personal access tokens and their watchers' reports
// (REQUIREMENTS AC-15, A-9; db/026).

// GET /api/account/tokens
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  return NextResponse.json(await listTokens(account.db));
}

// POST /api/account/tokens   { op: 'create', name } → { secret, tokens, reports } | { op: 'revoke', id }
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const b = await readBody(req);
  if (!b) return bad('Invalid body');
  let secret: string | undefined;
  try {
    if (b.op === 'create') {
      const name = text(b.name, 'The name', 80);
      if ('error' in name) return bad(name.error);
      secret = await createToken(account.db, name.value);
    } else if (b.op === 'revoke') {
      if (!Number.isInteger(b.id) || (b.id as number) <= 0) return bad('Name a token');
      await revokeToken(account.db, b.id as number);
    } else {
      return bad('Unknown operation');
    }
  } catch (err) {
    if (err instanceof TokenError) return bad(err.message);
    throw err;
  }
  return NextResponse.json({ secret, ...(await listTokens(account.db)) });
}

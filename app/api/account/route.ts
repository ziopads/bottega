import { NextResponse } from 'next/server';

import { MAX_DISPLAY_NAME, setDisplayName } from '@/lib/account';
import { apiAccount } from '@/lib/access';

export const dynamic = 'force-dynamic';

// The signed-in person's own account (REQUIREMENTS AC-13). For now, the name
// others see; db/010 set_my_display_name logs the change.

// PATCH /api/account   { displayName }
export async function PATCH(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const name = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!name) return NextResponse.json({ error: 'A display name cannot be empty.' }, { status: 400 });
  if (name.length > MAX_DISPLAY_NAME) {
    return NextResponse.json({ error: `A display name can be at most ${MAX_DISPLAY_NAME} characters.` }, { status: 400 });
  }
  return NextResponse.json({ displayName: await setDisplayName(account.db, name) });
}

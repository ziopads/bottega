import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { createGroup, StudyError } from '@/lib/study';
import { parseGroupDescription, parseGroupName } from '@/lib/studyInput';
import { bad, readBody } from '@/lib/studyRoutes';

export const dynamic = 'force-dynamic';

// POST /api/study/groups   { name, description? } → { id }
// Any active account creates a study group and becomes its custodian (L-7).
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const name = parseGroupName(body.name);
  if ('error' in name) return bad(name.error);
  const description = parseGroupDescription(body.description);
  if ('error' in description) return bad(description.error);
  try {
    const id = await createGroup(account.db, name.value, description.value);
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof StudyError) return bad(err.message);
    throw err;
  }
}

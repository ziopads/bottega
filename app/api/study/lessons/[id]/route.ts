import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { bad, parsePositiveId, patchEntry } from '@/lib/studyRoutes';

export const dynamic = 'force-dynamic';

// PATCH /api/study/lessons/:id   { title?, body? } | { accept } | { reject } | { move }
// The custodian's to do; a changed body has its citations checked again.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  return patchEntry(account, 'lesson', id, req);
}

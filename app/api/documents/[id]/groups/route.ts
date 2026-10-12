import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { documentGroups, shareWithGroup, StudyError, unshareFromGroup } from '@/lib/study';
import { bad, parsePositiveId, readBody } from '@/lib/studyRoutes';
import { parseOptionalId } from '@/lib/workflowInput';

export const dynamic = 'force-dynamic';

// A private document shared with a study group the owner belongs to, so the
// group's members can read it (view), as long as they remain members
// (REQUIREMENTS §15 decision 10, db/016). Owner only; logged by the database.

async function change(req: Request, ctx: { params: Promise<{ id: string }> }, share: boolean) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const body = await readBody(req);
  const group = parseOptionalId(body?.groupId);
  if ('error' in group || group.value === null) return bad('Which group?');
  try {
    if (share) await shareWithGroup(account.db, id, group.value);
    else await unshareFromGroup(account.db, id, group.value);
  } catch (err) {
    if (err instanceof StudyError) return bad(err.message);
    throw err;
  }
  return NextResponse.json({ groups: await documentGroups(account.db, id) });
}

// POST /api/documents/:id/groups   { groupId }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return change(req, ctx, true);
}

// DELETE /api/documents/:id/groups   { groupId }
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return change(req, ctx, false);
}

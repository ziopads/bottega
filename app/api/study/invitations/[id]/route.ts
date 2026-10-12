import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { answerInvitation, groupOf, StudyError } from '@/lib/study';
import { bad, parsePositiveId, readBody } from '@/lib/studyRoutes';

export const dynamic = 'force-dynamic';

// POST /api/study/invitations/:id   { accept: boolean } → { groupId, accepted }
// The invitee answers their own invitation (L-8).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const body = await readBody(req);
  if (!body || typeof body.accept !== 'boolean') return bad('Accept or decline.');
  const groupId = await groupOf(account.db, 'invitation', id);
  if (groupId === null) return bad('Not found.', 404);
  try {
    await answerInvitation(account.db, id, body.accept);
  } catch (err) {
    if (err instanceof StudyError) return bad(err.message);
    throw err;
  }
  return NextResponse.json({ groupId, accepted: body.accept });
}

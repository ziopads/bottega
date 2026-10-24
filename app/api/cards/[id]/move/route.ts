import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { moved, parseLearningMove } from '@/lib/moveRoutes';
import { cardToNote, itemToLearning, projectOf } from '@/lib/workflow';
import { bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// POST /api/cards/:id/move   { to: 'note' } | { to: 'learning', stage?, body? }
// A to-do becomes a note (its element, stage and done-when dropped, its mix
// and moment kept) or a learning on the project's template; the to-do leaves
// the project (REQUIREMENTS W-34, db/028). Its creator with contribute
// access, or anyone with edit; a learning also needs edit on the template.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const projectId = await projectOf(db, 'cards', id);
  if (!projectId) return bad('Not found.', 404);
  const refusal = await projectRefusal(db, projectId, 'contribute');
  if (refusal) return refusal;
  const body = (await readBody(req)) ?? {};
  if (body.to === 'note') return moved(db, projectId, () => cardToNote(db, id));
  if (body.to === 'learning') {
    const input = parseLearningMove(body);
    if ('error' in input) return bad(input.error);
    return moved(db, projectId, () => itemToLearning(db, 'cards', id, input.stage, input.text));
  }
  return bad('Move it to a note or a learning.');
}

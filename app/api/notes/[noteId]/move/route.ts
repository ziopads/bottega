import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { moved, parseLearningMove, parseTodoMove } from '@/lib/moveRoutes';
import { itemToLearning, noteToCard, projectOf } from '@/lib/workflow';
import { bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// POST /api/notes/:noteId/move
//   { to: 'todo', elementId?, doneWhen?, kind? } | { to: 'learning', stage?, body? }
// A note becomes a to-do in the project's current stage, keeping its mix and
// moment, or a learning on the project's template; the note leaves the
// project (REQUIREMENTS W-34, db/028). Its author with contribute access, or
// anyone with edit; a learning also needs edit on the template.
export async function POST(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).noteId);
  if (!id) return bad('Invalid id');
  const projectId = await projectOf(db, 'notes', id);
  if (!projectId) return bad('Not found.', 404);
  const refusal = await projectRefusal(db, projectId, 'contribute');
  if (refusal) return refusal;
  const body = (await readBody(req)) ?? {};
  if (body.to === 'todo') {
    const input = parseTodoMove(body);
    if ('error' in input) return bad(input.error);
    return moved(db, projectId, () => noteToCard(db, id, input));
  }
  if (body.to === 'learning') {
    const input = parseLearningMove(body);
    if ('error' in input) return bad(input.error);
    return moved(db, projectId, () => itemToLearning(db, 'notes', id, input.stage, input.text));
  }
  return bad('Move it to a to-do or a learning.');
}

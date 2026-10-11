import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { projectOf, settleNote } from '@/lib/workflow';
import { parseOptionalId, parseReason } from '@/lib/workflowInput';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// POST /api/notes/:noteId/settle   { reason?, elementId? } — a note becomes a
// settled decision (W-9): a card carrying its text, mix and moment.
export async function POST(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).noteId);
  if (!id) return bad('Invalid id');
  const projectId = await projectOf(db, 'notes', id);
  if (!projectId) return bad('Not found.', 404);
  const refusal = await projectRefusal(db, projectId, 'edit');
  if (refusal) return refusal;
  const body = (await readBody(req)) ?? {};
  const reason = parseReason(body.reason, false);
  if ('error' in reason) return bad(reason.error);
  const element = parseOptionalId(body.elementId);
  if ('error' in element) return bad(element.error);
  return answer(db, projectId, () => settleNote(db, id, reason.value, element.value));
}

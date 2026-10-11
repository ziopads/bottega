import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { addCriterion } from '@/lib/workflow';
import { parseCriterion, parseStage } from '@/lib/workflowInput';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// POST /api/projects/:id/criteria   { stage, body } — an exit criterion (W-3).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const refusal = await projectRefusal(db, id, 'edit');
  if (refusal) return refusal;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const stage = parseStage(body.stage);
  if ('error' in stage) return bad(stage.error);
  const text = parseCriterion(body.body);
  if ('error' in text) return bad(text.error);
  return answer(db, id, () => addCriterion(db, id, { stage: stage.value, body: text.value }));
}

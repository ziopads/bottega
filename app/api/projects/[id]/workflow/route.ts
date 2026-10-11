import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { getWorkflow, moveStage, startWorkflow } from '@/lib/workflow';
import { parseReason, parseStage } from '@/lib/workflowInput';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// A session's workflow (REQUIREMENTS W-1 to W-4, db/011).

// GET /api/projects/:id/workflow
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const refusal = await projectRefusal(account.db, id, 'view');
  if (refusal) return refusal;
  return NextResponse.json({ workflow: await getWorkflow(account.db, id) });
}

// POST /api/projects/:id/workflow   { op: 'start' } | { op: 'move', to, reason? }
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

  if (body.op === 'start') return answer(db, id, () => startWorkflow(db, id));
  if (body.op === 'move') {
    const to = parseStage(body.to);
    if ('error' in to) return bad(to.error);
    const reason = parseReason(body.reason, false);
    if ('error' in reason) return bad(reason.error);
    return answer(db, id, () => moveStage(db, id, to.value, reason.value));
  }
  return bad('Unknown operation');
}

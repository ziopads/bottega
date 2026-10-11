import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { deleteCriterion, projectOf, updateCriterion, type CriterionPatch } from '@/lib/workflow';
import { parseCriterion } from '@/lib/workflowInput';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// One exit criterion: reword it, tick it, accept or reject Claude's proposal
// (edit), or delete it (owner).

// PATCH /api/criteria/:id   { body?, met?, accept?, reject? }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const projectId = await projectOf(db, 'exit_criteria', id);
  if (!projectId) return bad('Not found.', 404);
  const refusal = await projectRefusal(db, projectId, 'edit');
  if (refusal) return refusal;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');

  const patch: CriterionPatch = {};
  if (body.body !== undefined) {
    const text = parseCriterion(body.body);
    if ('error' in text) return bad(text.error);
    patch.body = text.value;
  }
  if (typeof body.met === 'boolean') patch.met = body.met;
  if (body.accept === true) patch.accept = true;
  if (body.reject === true) patch.reject = true;
  return answer(db, projectId, () => updateCriterion(db, id, patch));
}

// DELETE /api/criteria/:id
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const projectId = await projectOf(db, 'exit_criteria', id);
  if (!projectId) return bad('Not found.', 404);
  const refusal = await projectRefusal(db, projectId, 'owner');
  if (refusal) return refusal;
  return answer(db, projectId, () => deleteCriterion(db, id));
}

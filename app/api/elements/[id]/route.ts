import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { deleteElement, projectOf, renameElement } from '@/lib/workflow';
import { parseElementName } from '@/lib/workflowInput';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// One element: rename it (edit) or delete it with the parts under it (owner).
// Its cards stay, without an element.

// PATCH /api/elements/:id   { name }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const projectId = await projectOf(db, 'elements', id);
  if (!projectId) return bad('Not found.', 404);
  const refusal = await projectRefusal(db, projectId, 'edit');
  if (refusal) return refusal;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const name = parseElementName(body.name);
  if ('error' in name) return bad(name.error);
  return answer(db, projectId, () => renameElement(db, id, name.value));
}

// DELETE /api/elements/:id
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const projectId = await projectOf(db, 'elements', id);
  if (!projectId) return bad('Not found.', 404);
  const refusal = await projectRefusal(db, projectId, 'owner');
  if (refusal) return refusal;
  return answer(db, projectId, () => deleteElement(db, id));
}

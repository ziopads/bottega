import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { addElement } from '@/lib/workflow';
import { parseElementName, parseOptionalId } from '@/lib/workflowInput';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// POST /api/projects/:id/elements   { name, parentId? } — a part of the work (W-5).
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
  const name = parseElementName(body.name);
  if ('error' in name) return bad(name.error);
  const parent = parseOptionalId(body.parentId);
  if ('error' in parent) return bad(parent.error);
  return answer(db, id, () => addElement(db, id, name.value, parent.value));
}

import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { addCard } from '@/lib/workflow';
import { parseDoneWhen, parseKind, parseOptionalId, parseStage, parseWhat } from '@/lib/workflowInput';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// POST /api/projects/:id/cards   { stage, elementId?, kind?, what, doneWhen } — a card (W-6).
// Contributors may add cards; a card for a later stage is parked (W-8).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const refusal = await projectRefusal(db, id, 'contribute');
  if (refusal) return refusal;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');

  const stage = parseStage(body.stage);
  if ('error' in stage) return bad(stage.error);
  const element = parseOptionalId(body.elementId);
  if ('error' in element) return bad(element.error);
  const kind = parseKind(body.kind);
  if ('error' in kind) return bad(kind.error);
  const what = parseWhat(body.what);
  if ('error' in what) return bad(what.error);
  const doneWhen = parseDoneWhen(body.doneWhen);
  if ('error' in doneWhen) return bad(doneWhen.error);
  return answer(db, id, () =>
    addCard(db, id, { stage: stage.value, elementId: element.value, kind: kind.value, what: what.value, doneWhen: doneWhen.value }),
  );
}

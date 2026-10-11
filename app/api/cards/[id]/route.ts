import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { deleteCard, getCard, reopenCard, settleCard, updateCard, type CardPatch } from '@/lib/workflow';
import {
  parseDoneWhen,
  parseKind,
  parseOptionalId,
  parseReason,
  parseStage,
  parseStatus,
  parseWhat,
} from '@/lib/workflowInput';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// One card (W-6 to W-9). Changing it: its author with contribute access, or
// anyone with edit access; accepting Claude's proposal is setting its status.
// Settling and reopening: edit. Deleting: the owner.

async function load(ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return { response: account };
  const id = parseId((await ctx.params).id);
  if (!id) return { response: bad('Invalid id') };
  const card = await getCard(account.db, id);
  if (!card) return { response: bad('Not found.', 404) };
  return { account, id, card };
}

// PATCH /api/cards/:id   { elementId?, stage?, kind?, what?, doneWhen?, status? }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const { account, id, card } = got;
  const { db } = account;
  const mine = card.createdById === account.userId;
  const refusal = await projectRefusal(db, card.projectId, mine ? 'contribute' : 'edit');
  if (refusal) return refusal;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');

  const patch: CardPatch = {};
  if (body.elementId !== undefined) {
    const v = parseOptionalId(body.elementId);
    if ('error' in v) return bad(v.error);
    patch.elementId = v.value;
  }
  if (body.stage !== undefined) {
    const v = parseStage(body.stage);
    if ('error' in v) return bad(v.error);
    patch.stage = v.value;
  }
  if (body.kind !== undefined) {
    const v = parseKind(body.kind);
    if ('error' in v) return bad(v.error);
    patch.kind = v.value;
  }
  if (body.what !== undefined) {
    const v = parseWhat(body.what);
    if ('error' in v) return bad(v.error);
    patch.what = v.value;
  }
  if (body.doneWhen !== undefined) {
    const v = parseDoneWhen(body.doneWhen);
    if ('error' in v) return bad(v.error);
    patch.doneWhen = v.value;
  }
  if (body.status !== undefined) {
    const v = parseStatus(body.status);
    if ('error' in v) return bad(v.error);
    patch.status = v.value;
  }
  return answer(db, card.projectId, () => updateCard(db, id, patch));
}

// POST /api/cards/:id   { op: 'settle', reason? } | { op: 'reopen', reason }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const { account, id, card } = got;
  const { db } = account;
  const refusal = await projectRefusal(db, card.projectId, 'edit');
  if (refusal) return refusal;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  if (body.op === 'settle') {
    const reason = parseReason(body.reason, false);
    if ('error' in reason) return bad(reason.error);
    return answer(db, card.projectId, () => settleCard(db, id, reason.value));
  }
  if (body.op === 'reopen') {
    const reason = parseReason(body.reason, true);
    if ('error' in reason) return bad(reason.error);
    return answer(db, card.projectId, () => reopenCard(db, id, reason.value));
  }
  return bad('Unknown operation');
}

// DELETE /api/cards/:id
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const { account, id, card } = got;
  const refusal = await projectRefusal(account.db, card.projectId, 'owner');
  if (refusal) return refusal;
  return answer(account.db, card.projectId, () => deleteCard(account.db, id));
}

import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { discardSession, groupOf, publishSession, StudyError, updateSession, type SessionInput } from '@/lib/study';
import { parseIdList, parseMinutes, parseSessionKind, parseSessionSummary, parseStartedAt } from '@/lib/studyInput';
import { answer, bad, parsePositiveId, readBody } from '@/lib/studyRoutes';

export const dynamic = 'force-dynamic';

// One study session (db/017). Its author changes it, publishes a draft
// (Claude's, documented through the connector) with its notes, or discards a
// draft. db/017 refuses anyone else.

async function load(ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return { response: account };
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return { response: bad('Invalid id') };
  const groupId = await groupOf(account.db, 'session', id);
  if (groupId === null) return { response: bad('Not found.', 404) };
  return { account, id, groupId };
}

// PATCH /api/study/sessions/:id   { startedAt?, minutes?, kind?, summary?, private?, topicIds? }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const { account, id, groupId } = got;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const patch: Partial<SessionInput> = {};
  try {
    const take = <T,>(p: { value: T } | { error: string }): T => {
      if ('error' in p) throw new StudyError(p.error);
      return p.value;
    };
    if (body.startedAt !== undefined) patch.startedAt = take(parseStartedAt(body.startedAt));
    if (body.minutes !== undefined) patch.minutes = take(parseMinutes(body.minutes));
    if (body.kind !== undefined) patch.kind = take(parseSessionKind(body.kind));
    if (body.summary !== undefined) patch.summary = take(parseSessionSummary(body.summary));
    if (body.private !== undefined) patch.private = body.private === true;
    if (body.topicIds !== undefined) patch.topicIds = take(parseIdList(body.topicIds));
  } catch (err) {
    if (err instanceof StudyError) return bad(err.message);
    throw err;
  }
  return answer(account.db, groupId, () => updateSession(account.db, id, patch));
}

// POST /api/study/sessions/:id   { op: 'publish' }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const body = await readBody(req);
  if (body?.op !== 'publish') return bad('Unknown operation');
  return answer(got.account.db, got.groupId, () => publishSession(got.account.db, got.id));
}

// DELETE /api/study/sessions/:id   discards one's own draft and its notes
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  return answer(got.account.db, got.groupId, () => discardSession(got.account.db, got.id));
}

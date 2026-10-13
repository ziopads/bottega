import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { groupOf, publishResource, removeResource, StudyError, updateResource } from '@/lib/study';
import { parseIdList, parseResourceTitle, parseResourceWhy } from '@/lib/studyInput';
import { answer, bad, parsePositiveId, readBody } from '@/lib/studyRoutes';

export const dynamic = 'force-dynamic';

// One video or link of a study group (db/020). The member who added it edits
// its title, why and topics, and publishes it when Claude added it as a
// draft; that member or the custodian removes it. db/020 refuses anyone else.

async function load(ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return { response: account };
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return { response: bad('Invalid id') };
  const groupId = await groupOf(account.db, 'resource', id);
  if (groupId === null) return { response: bad('Not found.', 404) };
  return { account, id, groupId };
}

// PATCH /api/study/resources/:id   { title?, why?, topicIds? }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const { account, id, groupId } = got;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const patch: { title?: string; why?: string; topicIds?: number[] } = {};
  try {
    if (body.title !== undefined) {
      const v = parseResourceTitle(body.title);
      if ('error' in v || !v.value) throw new StudyError('error' in v ? v.error : 'A title is needed.');
      patch.title = v.value;
    }
    if (body.why !== undefined) {
      const v = parseResourceWhy(body.why);
      if ('error' in v) throw new StudyError(v.error);
      patch.why = v.value;
    }
    if (body.topicIds !== undefined) {
      const v = parseIdList(body.topicIds);
      if ('error' in v) throw new StudyError(v.error);
      patch.topicIds = v.value;
    }
  } catch (err) {
    if (err instanceof StudyError) return bad(err.message);
    throw err;
  }
  return answer(account.db, groupId, () => updateResource(account.db, id, patch));
}

// POST /api/study/resources/:id   { op: 'publish' }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const body = await readBody(req);
  if (body?.op !== 'publish') return bad('Unknown operation');
  return answer(got.account.db, got.groupId, () => publishResource(got.account.db, got.id));
}

// DELETE /api/study/resources/:id
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  return answer(got.account.db, got.groupId, () => removeResource(got.account.db, got.id));
}

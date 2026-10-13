import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { discardNote, groupOf, StudyError, updateNote, type NoteInput } from '@/lib/study';
import { parseNoteBody, parseSeconds } from '@/lib/studyInput';
import { answer, bad, parsePositiveId, readBody } from '@/lib/studyRoutes';
import { parseOptionalId } from '@/lib/workflowInput';

export const dynamic = 'force-dynamic';

// One study note (db/017). Its author changes it or discards a draft; db/017
// refuses anyone else.

async function load(ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return { response: account };
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return { response: bad('Invalid id') };
  const groupId = await groupOf(account.db, 'note', id);
  if (groupId === null) return { response: bad('Not found.', 404) };
  return { account, id, groupId };
}

// PATCH /api/study/notes/:id   { body?, topicId?, lessonId?, exerciseId?, resourceId?, at?, private? }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const { account, id, groupId } = got;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const patch: Partial<NoteInput> = {};
  try {
    if (body.body !== undefined) {
      const v = parseNoteBody(body.body);
      if ('error' in v) throw new StudyError(v.error);
      patch.body = v.value;
    }
    if (body.at !== undefined) {
      const v = parseSeconds(body.at);
      if ('error' in v) throw new StudyError(v.error);
      patch.positionS = v.value;
    }
    for (const key of ['topicId', 'lessonId', 'exerciseId', 'resourceId'] as const) {
      if (body[key] === undefined) continue;
      const v = parseOptionalId(body[key]);
      if ('error' in v) throw new StudyError(v.error);
      patch[key] = v.value;
    }
    if (body.private !== undefined) patch.private = body.private === true;
  } catch (err) {
    if (err instanceof StudyError) return bad(err.message);
    throw err;
  }
  return answer(account.db, groupId, () => updateNote(account.db, id, patch));
}

// DELETE /api/study/notes/:id   discards one's own draft note
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  return answer(got.account.db, got.groupId, () => discardNote(got.account.db, got.id));
}

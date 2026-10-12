import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { groupOf, setProgress } from '@/lib/study';
import { parseProgressNote, parseProgressStatus } from '@/lib/studyInput';
import { answer, bad, parsePositiveId, patchEntry, readBody } from '@/lib/studyRoutes';

export const dynamic = 'force-dynamic';

// One exercise. The custodian edits, reorders and reviews it; each member
// records their own progress on it (L-5).

// PATCH /api/study/exercises/:id   { task?, doneWhen?, lessonId? } | { accept } | { reject } | { move }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  return patchEntry(account, 'exercise', id, req);
}

// PUT /api/study/exercises/:id   { status, note? }   the person's own progress
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const groupId = await groupOf(db, 'exercise', id);
  if (groupId === null) return bad('Not found.', 404);
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const status = parseProgressStatus(body.status);
  if ('error' in status) return bad(status.error);
  const note = parseProgressNote(body.note);
  if ('error' in note) return bad(note.error);
  return answer(db, groupId, () => setProgress(db, id, status.value, note.value));
}

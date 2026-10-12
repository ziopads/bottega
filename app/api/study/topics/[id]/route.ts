import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { addExercise, addLesson, groupOf } from '@/lib/study';
import { parseExerciseDone, parseLessonBody, parseLessonTitle, parseTask } from '@/lib/studyInput';
import { answer, bad, parsePositiveId, patchEntry, readBody } from '@/lib/studyRoutes';
import { parseOptionalId } from '@/lib/workflowInput';

export const dynamic = 'force-dynamic';

// One topic of a group's syllabus. The custodian edits, reorders and reviews
// it, and writes its lessons and exercises.

// PATCH /api/study/topics/:id   { title?, summary?, modelId? } | { accept } | { reject } | { move }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  return patchEntry(account, 'topic', id, req);
}

// POST /api/study/topics/:id   { op: 'lesson', title, body } | { op: 'exercise', task, doneWhen, lessonId? }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const groupId = await groupOf(db, 'topic', id);
  if (groupId === null) return bad('Not found.', 404);
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  if (body.op === 'lesson') {
    const title = parseLessonTitle(body.title);
    if ('error' in title) return bad(title.error);
    const text = parseLessonBody(body.body);
    if ('error' in text) return bad(text.error);
    return answer(db, groupId, () => addLesson(db, id, { title: title.value, body: text.value }, 'human'));
  }
  if (body.op === 'exercise') {
    const task = parseTask(body.task);
    if ('error' in task) return bad(task.error);
    const done = parseExerciseDone(body.doneWhen);
    if ('error' in done) return bad(done.error);
    const lesson = parseOptionalId(body.lessonId);
    if ('error' in lesson) return bad(lesson.error);
    return answer(db, groupId, () => addExercise(db, id, { task: task.value, doneWhen: done.value, lessonId: lesson.value }, 'human'));
  }
  return bad('Unknown operation');
}

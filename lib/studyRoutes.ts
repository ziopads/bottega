import { NextResponse } from 'next/server';

import type { Account } from '@/lib/access';
import type { Scoped } from '@/lib/db';
import { getGroup, groupOf, moveEntry, reviewEntry, StudyError, updateEntry } from '@/lib/study';
import {
  parseExerciseDone,
  parseLessonBody,
  parseLessonTitle,
  parseTask,
  parseTopicSummary,
  parseTopicTitle,
} from '@/lib/studyInput';
import { parseOptionalId } from '@/lib/workflowInput';
import { bad, readBody } from '@/lib/workflowRoutes';

// Shared by the Learning section's route handlers. Every change answers with
// the whole group, so the page never drifts from the database; a refusal from
// db/016 comes back as a 400 the page shows as it stands.

export async function answer(db: Scoped, groupId: number, change: () => Promise<unknown>) {
  try {
    await change();
  } catch (err) {
    if (err instanceof StudyError) return bad(err.message);
    throw err;
  }
  const group = await getGroup(db, groupId);
  return NextResponse.json({ group });
}

/**
 * PATCH on one topic, lesson or exercise:
 *   { accept: true } | { reject: true } | { move: 'up' | 'down' } | the entry's fields.
 * The database lets only the custodian through; anyone else gets its refusal.
 */
export async function patchEntry(account: Account, kind: 'topic' | 'lesson' | 'exercise', id: number, req: Request) {
  const { db } = account;
  const groupId = await groupOf(db, kind, id);
  if (groupId === null) return bad('Not found.', 404);
  const body = await readBody(req);
  if (!body) return bad('Invalid body');

  if (body.accept === true) return answer(db, groupId, () => reviewEntry(db, kind, id, true));
  if (body.reject === true) return answer(db, groupId, () => reviewEntry(db, kind, id, false));
  if (body.move === 'up' || body.move === 'down') return answer(db, groupId, () => moveEntry(db, kind, id, body.move as 'up' | 'down'));

  const patch: Record<string, unknown> = {};
  const take = (key: string, parsed: { value: unknown } | { error: string }) => {
    if ('error' in parsed) throw new StudyError(parsed.error);
    patch[key] = parsed.value;
  };
  try {
    if (kind === 'topic') {
      if (body.title !== undefined) take('title', parseTopicTitle(body.title));
      if (body.summary !== undefined) take('summary', parseTopicSummary(body.summary));
      if (body.modelId !== undefined) take('modelId', parseOptionalId(body.modelId));
    } else if (kind === 'lesson') {
      if (body.title !== undefined) take('title', parseLessonTitle(body.title));
      if (body.body !== undefined) take('body', parseLessonBody(body.body));
    } else {
      if (body.task !== undefined) take('task', parseTask(body.task));
      if (body.doneWhen !== undefined) take('doneWhen', parseExerciseDone(body.doneWhen));
      if (body.lessonId !== undefined) take('lessonId', parseOptionalId(body.lessonId));
    }
  } catch (err) {
    if (err instanceof StudyError) return bad(err.message);
    throw err;
  }
  return answer(db, groupId, () => updateEntry(db, kind, id, patch));
}

export function parsePositiveId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export { bad, readBody };

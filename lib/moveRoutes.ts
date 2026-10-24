import { NextResponse } from 'next/server';

import type { Scoped } from '@/lib/db';
import { listNotes } from '@/lib/studio';
import { getWorkflow, WorkflowError } from '@/lib/workflow';
import { parseKind, parseOptionalId, parseStage, text } from '@/lib/workflowInput';
import { LEARNING_MAX, type CardKind } from '@/lib/workflowTypes';
import { bad } from '@/lib/workflowRoutes';

// Shared by the routes that move an item between a note, a to-do and a
// learning (REQUIREMENTS W-34, db/028). A move changes the Notes tab and the
// Workflow tab together, so the answer carries both.

export async function moved(db: Scoped, projectId: number, change: () => Promise<number>) {
  let movedId: number;
  try {
    movedId = await change();
  } catch (err) {
    if (err instanceof WorkflowError) return bad(err.message);
    throw err;
  }
  const [workflow, notes] = await Promise.all([getWorkflow(db, projectId), listNotes(db, projectId)]);
  // movedId: the new to-do, note or learning, for an undo.
  return NextResponse.json({ workflow, notes, movedId });
}

/** A learning's stage and wording, both optional: the item's stage and its own text otherwise. */
export function parseLearningMove(body: Record<string, unknown>): { error: string } | { stage: string | null; text: string | null } {
  let stage: string | null = null;
  if (body.stage !== undefined && body.stage !== null && body.stage !== '') {
    const v = parseStage(body.stage);
    if ('error' in v) return v;
    stage = v.value;
  }
  let wording: string | null = null;
  if (typeof body.body === 'string' && body.body.trim()) {
    const v = text(body.body, 'The learning', LEARNING_MAX);
    if ('error' in v) return v;
    wording = v.value;
  }
  return { stage, text: wording };
}

/** A to-do made from a note: element, done-when and kind, all optional. */
export function parseTodoMove(
  body: Record<string, unknown>,
): { error: string } | { elementId: number | null; doneWhen: string; kind: CardKind | null } {
  const element = parseOptionalId(body.elementId ?? null);
  if ('error' in element) return element;
  const done = text(body.doneWhen ?? '', 'Done when', 1000, false);
  if ('error' in done) return done;
  let kind: CardKind | null = null;
  if (body.kind !== undefined && body.kind !== null && body.kind !== '') {
    const k = parseKind(body.kind);
    if ('error' in k) return k;
    kind = k.value;
  }
  return { elementId: element.value, doneWhen: done.value, kind };
}

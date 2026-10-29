import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import {
  acceptLearning,
  addLearning,
  applyStructureChanges,
  applyTemplateChanges,
  deleteLearning,
  editLearning,
  getWorkflow,
  WorkflowError,
  setNextCard,
  startWorkflow,
} from '@/lib/workflow';
import { parseOptionalId, parseStage, text } from '@/lib/workflowInput';
import { LEARNING_MAX } from '@/lib/workflowTypes';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// A project's workflow (REQUIREMENTS W-1 to W-4, W-17, W-31, W-33, W-38; db/011, db/024, db/028, db/029).

// GET /api/projects/:id/workflow
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const refusal = await projectRefusal(account.db, id, 'view');
  if (refusal) return refusal;
  return NextResponse.json({ workflow: await getWorkflow(account.db, id) });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// POST /api/projects/:id/workflow
//   edit:       { op: 'start', templateId?, structureId? } | { op: 'template', uids: string[] }
//               | { op: 'structure', uids: string[] }
//   contribute: { op: 'next-card', cardId | null }   the to-do to start with next (db/029); done passes it on
//   learnings:  { op: 'learning', action: 'add', stage, body } | { op: 'learning', action: 'edit', id, body }
//               | { op: 'learning', action: 'accept' | 'delete', id }
//               Any access to the project; the database lets only those who can edit the template change it.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const contributing = body.op === 'next-card';
  const refusal = await projectRefusal(db, id, body.op === 'learning' ? 'view' : contributing ? 'contribute' : 'edit');
  if (refusal) return refusal;

  if (body.op === 'learning') {
    if (body.action === 'add') {
      const stage = parseStage(body.stage);
      if ('error' in stage) return bad(stage.error);
      const b = text(body.body, 'The learning', LEARNING_MAX);
      if ('error' in b) return bad(b.error);
      return answer(db, id, () => addLearning(db, id, stage.value, b.value));
    }
    const lid = parseId(String(body.id ?? ''));
    if (!lid) return bad('Name a learning');
    const missing = () => {
      throw new WorkflowError('That learning is not one you can change.');
    };
    if (body.action === 'edit') {
      const b = text(body.body, 'The learning', LEARNING_MAX);
      if ('error' in b) return bad(b.error);
      return answer(db, id, async () => (await editLearning(db, id, lid, b.value)) || missing());
    }
    if (body.action === 'accept') return answer(db, id, async () => (await acceptLearning(db, id, lid)) || missing());
    if (body.action === 'delete') return answer(db, id, async () => (await deleteLearning(db, id, lid)) || missing());
    return bad('Unknown operation');
  }

  if (body.op === 'next-card') {
    const card = parseOptionalId(body.cardId ?? null);
    if ('error' in card) return bad(card.error);
    return answer(db, id, () => setNextCard(db, id, card.value));
  }
  if (body.op === 'structure') {
    const uids = Array.isArray(body.uids) ? body.uids : [];
    if (uids.length > 200 || !uids.every((u) => typeof u === 'string' && UUID.test(u))) return bad('Invalid list of changes');
    return answer(db, id, () => applyStructureChanges(db, id, uids as string[]));
  }
  if (body.op === 'template') {
    const uids = Array.isArray(body.uids) ? body.uids : [];
    if (uids.length > 200 || !uids.every((u) => typeof u === 'string' && UUID.test(u))) return bad('Invalid list of changes');
    return answer(db, id, () => applyTemplateChanges(db, id, uids as string[]));
  }

  if (body.op === 'start') {
    const templateId = parseOptionalId(body.templateId ?? null);
    if ('error' in templateId) return bad(templateId.error);
    const structureId = parseOptionalId(body.structureId ?? null);
    if ('error' in structureId) return bad(structureId.error);
    return answer(db, id, () => startWorkflow(db, id, { templateId: templateId.value, structureId: structureId.value }));
  }
  return bad('Unknown operation');
}

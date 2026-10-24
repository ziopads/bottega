import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import {
  acceptLearning,
  addLearning,
  applyStructureChanges,
  applyTemplateChanges,
  deleteLearning,
  editLearning,
  endSession,
  getWorkflow,
  moveStage,
  WorkflowError,
  pullNext,
  setNext,
  startWorkflow,
} from '@/lib/workflow';
import { parseOptionalId, parseReason, parseStage, text } from '@/lib/workflowInput';
import { LEARNING_MAX } from '@/lib/workflowTypes';
import { answer, bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// A project's workflow (REQUIREMENTS W-1 to W-4, W-17, W-19, W-20, W-31, W-33; db/011, db/024, db/028).

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
//   edit:       { op: 'start', templateId?, structureId? } | { op: 'move', to, reason? } | { op: 'template', uids: string[] }
//               | { op: 'structure', uids: string[] }
//   contribute: { op: 'next', next?, blocker? } | { op: 'end-session', did, next, lines: string[] } | { op: 'pull-next' }
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
  const contributing = body.op === 'next' || body.op === 'end-session' || body.op === 'pull-next';
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

  if (body.op === 'next') {
    const next = body.next === undefined ? undefined : text(body.next, 'The next move', 1000, false);
    if (next && 'error' in next) return bad(next.error);
    const blocker = body.blocker === undefined ? undefined : text(body.blocker, 'The blocker', 500, false);
    if (blocker && 'error' in blocker) return bad(blocker.error);
    return answer(db, id, () => setNext(db, id, next?.value, blocker?.value));
  }
  if (body.op === 'end-session') {
    const did = text(body.did, 'What was done', 2000, false);
    if ('error' in did) return bad(did.error);
    const next = text(body.next, 'The next move', 1000, false);
    if ('error' in next) return bad(next.error);
    const lines = Array.isArray(body.lines) ? body.lines.filter((l): l is string => typeof l === 'string') : [];
    if (lines.length > 50) return bad('Keep it to 50 lines at a time.');
    return answer(db, id, async () => endSession(db, id, { did: did.value, next: next.value, lines }, await getWorkflow(db, id)));
  }
  if (body.op === 'pull-next') return answer(db, id, async () => pullNext(db, id, await getWorkflow(db, id)));
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
  if (body.op === 'move') {
    const to = parseStage(body.to);
    if ('error' in to) return bad(to.error);
    const reason = parseReason(body.reason, false);
    if ('error' in reason) return bad(reason.error);
    return answer(db, id, () => moveStage(db, id, to.value, reason.value));
  }
  return bad('Unknown operation');
}

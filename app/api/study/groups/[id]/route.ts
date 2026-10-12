import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import {
  addTopic,
  getGroup,
  invite,
  leaveGroup,
  removeMember,
  setGroupStatus,
  updateGroup,
  withdrawInvitation,
} from '@/lib/study';
import { parseGroupDescription, parseGroupName, parseTopicSummary, parseTopicTitle } from '@/lib/studyInput';
import { answer, bad, parsePositiveId, readBody } from '@/lib/studyRoutes';
import { parseOptionalId } from '@/lib/workflowInput';

export const dynamic = 'force-dynamic';

// One study group (L-7 to L-10). Members read it; the custodian names it,
// closes and reopens it, invites, withdraws invitations, removes members and
// writes topics; a member leaves. db/016 enforces each rule.

async function load(ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return { response: account };
  const id = parsePositiveId((await ctx.params).id);
  if (!id) return { response: bad('Invalid id') };
  return { account, id };
}

// GET /api/study/groups/:id → { group }
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const group = await getGroup(got.account.db, got.id);
  if (!group) return bad('Not found.', 404);
  return NextResponse.json({ group });
}

// PATCH /api/study/groups/:id   { name?, description?, status? }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const { account, id } = got;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const patch: { name?: string; description?: string } = {};
  if (body.name !== undefined) {
    const v = parseGroupName(body.name);
    if ('error' in v) return bad(v.error);
    patch.name = v.value;
  }
  if (body.description !== undefined) {
    const v = parseGroupDescription(body.description);
    if ('error' in v) return bad(v.error);
    patch.description = v.value;
  }
  const status = body.status;
  if (status !== undefined && status !== 'open' && status !== 'closed') return bad('A group is open or closed.');
  return answer(account.db, id, async () => {
    await updateGroup(account.db, id, patch);
    if (status) await setGroupStatus(account.db, id, status);
  });
}

// POST /api/study/groups/:id
//   { op: 'invite', email } | { op: 'withdraw', invitationId } | { op: 'remove', accountId } | { op: 'leave' }
//   | { op: 'topic', title, summary?, modelId? }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const got = await load(ctx);
  if ('response' in got) return got.response;
  const { account, id } = got;
  const { db } = account;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  switch (body.op) {
    case 'invite':
      if (typeof body.email !== 'string' || !body.email.trim()) return bad('Give their email.');
      return answer(db, id, () => invite(db, id, body.email as string));
    case 'withdraw': {
      const inv = parseOptionalId(body.invitationId);
      if ('error' in inv || inv.value === null) return bad('Which invitation?');
      return answer(db, id, () => withdrawInvitation(db, inv.value as number));
    }
    case 'remove':
      if (typeof body.accountId !== 'string' || !body.accountId) return bad('Whom?');
      return answer(db, id, () => removeMember(db, id, body.accountId as string));
    case 'leave':
      try {
        await leaveGroup(db, id);
      } catch (err) {
        return bad((err as Error).message);
      }
      return NextResponse.json({ left: true });
    case 'topic': {
      const title = parseTopicTitle(body.title);
      if ('error' in title) return bad(title.error);
      const summary = parseTopicSummary(body.summary);
      if ('error' in summary) return bad(summary.error);
      const model = parseOptionalId(body.modelId);
      if ('error' in model) return bad(model.error);
      return answer(db, id, () => addTopic(db, id, { title: title.value, summary: summary.value, modelId: model.value }, 'human'));
    }
    default:
      return bad('Unknown operation');
  }
}

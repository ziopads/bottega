import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import {
  addNote,
  addResource,
  addTopic,
  createSession,
  resourceFromUrl,
  StudyError,
  getGroup,
  invite,
  leaveGroup,
  removeMember,
  setGroupStatus,
  updateGroup,
  withdrawInvitation,
} from '@/lib/study';
import {
  parseGroupDescription,
  parseGroupName,
  parseIdList,
  parseMinutes,
  parseNoteBody,
  parseResourceTitle,
  parseResourceWhy,
  parseSeconds,
  parseSessionKind,
  parseSessionSummary,
  parseStartedAt,
  parseTopicSummary,
  parseTopicTitle,
} from '@/lib/studyInput';
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
//   | { op: 'session', startedAt?, minutes?, kind?, summary?, private?, topicIds? }   the person's own, published
//   | { op: 'note', body, sessionId?, topicId?, lessonId?, exerciseId?, resourceId?, at?, private? }   the person's own
//   | { op: 'resource', url, title?, why?, topicIds? }   a YouTube video or a link
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
    case 'session': {
      const startedAt = parseStartedAt(body.startedAt);
      if ('error' in startedAt) return bad(startedAt.error);
      const minutes = parseMinutes(body.minutes);
      if ('error' in minutes) return bad(minutes.error);
      const kind = parseSessionKind(body.kind);
      if ('error' in kind) return bad(kind.error);
      const summary = parseSessionSummary(body.summary);
      if ('error' in summary) return bad(summary.error);
      const topics = parseIdList(body.topicIds);
      if ('error' in topics) return bad(topics.error);
      const resource = parseOptionalId(body.resourceId);
      if ('error' in resource) return bad(resource.error);
      return answer(db, id, () =>
        createSession(
          db,
          id,
          {
            startedAt: startedAt.value,
            minutes: minutes.value,
            kind: kind.value,
            summary: summary.value,
            private: body.private === true,
            topicIds: topics.value,
            resourceId: resource.value,
          },
          'human',
        ),
      );
    }
    case 'note': {
      const text = parseNoteBody(body.body);
      if ('error' in text) return bad(text.error);
      const ids: Record<string, number | null> = {};
      const at = parseSeconds(body.at);
      if ('error' in at) return bad(at.error);
      for (const key of ['sessionId', 'topicId', 'lessonId', 'exerciseId', 'resourceId']) {
        const v = parseOptionalId(body[key]);
        if ('error' in v) return bad(v.error);
        ids[key] = v.value;
      }
      return answer(db, id, () =>
        addNote(
          db,
          id,
          {
            body: text.value,
            sessionId: ids.sessionId,
            topicId: ids.topicId,
            lessonId: ids.lessonId,
            exerciseId: ids.exerciseId,
            resourceId: ids.resourceId,
            positionS: at.value,
            private: body.private === true,
          },
          'human',
        ),
      );
    }
    case 'resource': {
      if (typeof body.url !== 'string' || !body.url.trim()) return bad('Give the address.');
      const title = parseResourceTitle(body.title);
      if ('error' in title) return bad(title.error);
      const why = parseResourceWhy(body.why);
      if ('error' in why) return bad(why.error);
      const topics = parseIdList(body.topicIds);
      if ('error' in topics) return bad(topics.error);
      let input;
      try {
        input = await resourceFromUrl(body.url, { title: title.value, why: why.value, topicIds: topics.value });
      } catch (err) {
        if (err instanceof StudyError) return bad(err.message);
        throw err;
      }
      return answer(db, id, () => addResource(db, id, input, 'human'));
    }
    default:
      return bad('Unknown operation');
  }
}

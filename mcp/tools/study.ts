// The Learning section on the connector (REQUIREMENTS §10, M-2, M-3, M-4,
// L-18 to L-22):
// get_study_group reads a group's syllabus, proposals and progress;
// draft_topic, draft_lesson and draft_exercise propose syllabus entries,
// stored as written by the assistant and unreviewed, in the connected
// person's name, until the group's custodian accepts or rejects them. A
// lesson's citation markers are checked against the page text before it is
// stored, and one that fails refuses the whole lesson. record_study_session
// documents one of the person's own study sessions with its notes, as a draft
// only they see until they publish it in the app; list_study_notes and
// get_study_history read the group's record. Nothing here edits or deletes.

import type { Scoped } from '@/lib/db';
import { listModels } from '@/lib/gear';
import {
  addExercise,
  addLesson,
  addResource,
  addTopic,
  checkCitations,
  createSession,
  getGroup,
  groupOf,
  listMyGroups,
  resourceFromUrl,
  StudyError,
} from '@/lib/study';
import {
  parseExerciseDone,
  parseLessonBody,
  parseLessonTitle,
  parseMinutes,
  parseNoteBody,
  parseResourceTitle,
  parseResourceWhy,
  parseSeconds,
  parseSessionKind,
  parseSessionSummary,
  parseStartedAt,
  parseTask,
  parseTopicSummary,
  parseTopicTitle,
} from '@/lib/studyInput';
import { lessonHref, resourceHref, studyHistory, tabHref, type StudyGroup } from '@/lib/studyTypes';
import { formatTime } from '@/lib/youtube';
import { ToolError } from '@/mcp/context';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function clean<T>(p: { value: T } | { error: string }): T {
  if ('error' in p) throw new ToolError(p.error);
  return p.value;
}

function readable<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof StudyError) throw new ToolError(err.message);
    throw err;
  });
}

async function memberGroup(db: Scoped, groupId: number): Promise<StudyGroup> {
  const g = await getGroup(db, groupId);
  if (!g) throw new ToolError(`No study group ${groupId} that you belong to. get_study_group without an id lists yours.`);
  if (g.status === 'closed') throw new ToolError(`${g.name} is closed: it can be read, but nothing new is written until the custodian reopens it.`);
  return g;
}

export async function getStudyGroupTool(db: Scoped, origin: string, args: { id?: number; topic?: number }) {
  if (args.id === undefined) {
    const { groups, invitations } = await listMyGroups(db);
    return {
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description || null,
        custodian: g.custodianName,
        members: g.memberCount,
        topics: g.topicCount,
        proposals_waiting: g.waiting,
        closed: g.status === 'closed' || undefined,
        link: `${origin}/learning/${g.id}`,
      })),
      invitations_waiting: invitations.length ? invitations.map((i) => `${i.groupName} (from ${i.invitedByName})`) : undefined,
      next: 'Pass a group id to see its syllabus.',
    };
  }

  const g = await getGroup(db, args.id);
  if (!g) throw new ToolError(`No study group ${args.id} that you belong to. get_study_group without an id lists yours.`);
  const me = db.person.userId;
  const titles = new Map(g.documents.map((d) => [d.id, d.title]));
  const progressOf = (e: StudyGroup['exercises'][number]) =>
    g.members.map((m) => {
      const p = e.progress.find((x) => x.accountId === m.accountId);
      return { member: m.name, status: p?.status ?? 'not started', note: p?.note || undefined };
    });
  const accepted = g.topics.filter((t) => t.review === 'accepted');

  return {
    id: g.id,
    name: g.name,
    description: g.description || null,
    custodian: g.custodianName,
    you_are_custodian: g.custodianId === me,
    closed: g.status === 'closed' || undefined,
    members: g.members.map((m) => m.name),
    link: `${origin}/learning/${g.id}`,
    sessions_recorded: g.sessions.filter((x) => x.published).length,
    your_draft_sessions: g.sessions.filter((x) => !x.published && x.authorId === me).length || undefined,
    syllabus: accepted.map((t, i) => {
      const lessons = g.lessons.filter((l) => l.topicId === t.id && l.review === 'accepted');
      return {
        topic_id: t.id,
        number: i + 1,
        title: t.title,
        summary: t.summary || undefined,
        instrument: t.model ? `${t.model.manufacturer} ${t.model.model}` : undefined,
        lessons: lessons.map((l, j) => ({
          lesson_id: l.id,
          number: `${i + 1}.${j + 1}`,
          title: l.title,
          body: args.topic === t.id ? l.body : undefined,
          link: `${origin}${lessonHref(g.id, l.id)}`,
        })),
        exercises: g.exercises
          .filter((e) => e.topicId === t.id && e.review === 'accepted')
          .map((e) => ({
            exercise_id: e.id,
            task: e.task,
            done_when: e.doneWhen,
            lesson_id: e.lessonId ?? undefined,
            progress: progressOf(e),
          })),
      };
    }),
    awaiting_review: {
      topics: g.topics.filter((t) => t.review === 'proposed').map((t) => ({ topic_id: t.id, title: t.title, asked_by: t.createdByName })),
      lessons: g.lessons
        .filter((l) => l.review === 'proposed')
        .map((l) => ({ lesson_id: l.id, topic_id: l.topicId, title: l.title, asked_by: l.createdByName })),
      exercises: g.exercises
        .filter((e) => e.review === 'proposed')
        .map((e) => ({ exercise_id: e.id, topic_id: e.topicId, task: e.task, asked_by: e.createdByName })),
    },
    reading_list: g.documents
      .filter((d) => d.sharedWithGroup)
      .map((d) => ({
        document_id: d.id,
        title: titles.get(d.id) ?? '(not readable by you)',
        about: d.about || undefined,
        kind: d.library ? 'library manual' : 'shared by a member',
        searchable: d.pagesDone === 0 ? 'not yet' : d.pageCount !== null && d.pagesDone < d.pageCount ? `pages 1–${d.pagesDone}` : 'yes',
        cited_in_lessons: d.citedBy || undefined,
      })),
    videos_and_links: g.resources
      .filter((r) => r.published || r.addedById === me)
      .map((r) => ({
        resource_id: r.id,
        kind: r.kind,
        title: r.title,
        channel: r.channel || undefined,
        topics: r.topicIds.map((t) => g.topics.find((x) => x.id === t)?.title),
        why: r.why || undefined,
        added_by: r.addedByName,
        notes: g.notes.filter((n) => n.resourceId === r.id).length || undefined,
        draft: !r.published || undefined,
        link: `${origin}${resourceHref(g.id, r.id)}`,
      })),
    cited_not_on_list: g.documents
      .filter((d) => !d.sharedWithGroup && d.citedBy > 0)
      .map((d) => ({ document_id: d.id, title: titles.get(d.id) ?? '(not readable by you)', cited_in_lessons: d.citedBy })),
    note:
      'Topics, lessons and exercises under awaiting_review are proposals, not the group’s syllabus, until the custodian accepts them. ' +
      'Pass topic (a topic_id) to include the full text of that topic’s lessons. Progress is each member’s own record. ' +
      'Search the reading list with search({ group: id }).',
  };
}

export async function draftTopicTool(db: Scoped, origin: string, args: { group_id: number; title: string; summary?: string; instrument?: string }) {
  const g = await memberGroup(db, args.group_id);
  const title = clean(parseTopicTitle(args.title));
  const summary = clean(parseTopicSummary(args.summary ?? ''));
  const same = g.topics.find((t) => t.review !== 'rejected' && norm(t.title) === norm(title));
  if (same) throw new ToolError(`${g.name} already has the topic "${same.title}" (topic_id ${same.id}, ${same.review}). Draft lessons into it instead.`);

  let modelId: number | null = null;
  if (args.instrument && args.instrument.trim()) {
    const asked = norm(args.instrument);
    const models = (await listModels(db)).filter((m) => m.status === 'approved');
    const full = models.filter((m) => norm(`${m.manufacturer} ${m.model}`) === asked || norm(m.model) === asked);
    const partial = full.length ? full : models.filter((m) => norm(`${m.manufacturer} ${m.model}`).includes(asked));
    if (partial.length !== 1) {
      throw new ToolError(
        partial.length
          ? `"${args.instrument}" matches ${partial.map((m) => `${m.manufacturer} ${m.model}`).join(', ')}; name one.`
          : `No catalogue model "${args.instrument}". Leave instrument out, or name a model in Bottega's catalogue.`,
      );
    }
    modelId = partial[0].id;
  }

  const id = await readable(() => addTopic(db, g.id, { title, summary, modelId }, 'assistant'));
  return {
    proposed: { topic_id: id, group: g.name, title, summary: summary || undefined },
    next:
      `This waits in the review band on ${origin}/learning/${g.id} until ${g.custodianName}, the custodian, accepts or rejects it. ` +
      'You can draft lessons and exercises into it now; they wait with it.',
  };
}

export async function draftLessonTool(db: Scoped, origin: string, args: { topic_id: number; title: string; body: string }) {
  const groupId = await groupOf(db, 'topic', args.topic_id);
  if (groupId === null) throw new ToolError(`No topic ${args.topic_id} in a group you belong to. get_study_group gives the topic ids.`);
  const g = await memberGroup(db, groupId);
  const topic = g.topics.find((t) => t.id === args.topic_id)!;
  if (topic.review === 'rejected') throw new ToolError(`The topic "${topic.title}" was rejected; propose under another.`);
  const title = clean(parseLessonTitle(args.title));
  const body = clean(parseLessonBody(args.body));
  const problems = await checkCitations(db, body);
  if (problems.length) {
    throw new ToolError(
      `Nothing was stored. Fix these citations and send the lesson again: ${problems.join(' ')} ` +
        'Read the pages with read_pages and copy quotations exactly.',
    );
  }
  const id = await readable(() => addLesson(db, topic.id, { title, body }, 'assistant'));
  return {
    proposed: { lesson_id: id, topic: topic.title, title, link: `${origin}${lessonHref(g.id, id)}` },
    citations_checked: true,
    next: `This waits in the review band on ${origin}/learning/${g.id} until ${g.custodianName}, the custodian, accepts or rejects it.`,
  };
}

export async function draftExerciseTool(
  db: Scoped,
  origin: string,
  args: { topic_id: number; task: string; done_when: string; lesson_id?: number },
) {
  const groupId = await groupOf(db, 'topic', args.topic_id);
  if (groupId === null) throw new ToolError(`No topic ${args.topic_id} in a group you belong to. get_study_group gives the topic ids.`);
  const g = await memberGroup(db, groupId);
  const topic = g.topics.find((t) => t.id === args.topic_id)!;
  if (topic.review === 'rejected') throw new ToolError(`The topic "${topic.title}" was rejected; propose under another.`);
  const task = clean(parseTask(args.task));
  const doneWhen = clean(parseExerciseDone(args.done_when));
  let lessonId: number | null = null;
  if (args.lesson_id !== undefined) {
    const lesson = g.lessons.find((l) => l.id === args.lesson_id && l.topicId === topic.id && l.review !== 'rejected');
    if (!lesson) throw new ToolError(`Lesson ${args.lesson_id} is not in the topic "${topic.title}".`);
    lessonId = lesson.id;
  }
  const id = await readable(() => addExercise(db, topic.id, { task, doneWhen, lessonId }, 'assistant'));
  return {
    proposed: { exercise_id: id, topic: topic.title, lesson_id: lessonId ?? undefined, task, done_when: doneWhen },
    next: `This waits in the review band on ${origin}/learning/${g.id} until ${g.custodianName}, the custodian, accepts or rejects it.`,
  };
}

// ── Sessions and notes (db/017) ──────────────────────────────────────────────

/** A topic by id or by title (any case, or a unique part of it), among the group's topics not rejected. */
function topicId(g: StudyGroup, raw: string | number): number {
  const live = g.topics.filter((t) => t.review !== 'rejected');
  let found: StudyGroup['topics'][number] | undefined;
  if (typeof raw === 'number' || /^\d+$/.test(String(raw).trim())) {
    found = live.find((t) => t.id === Number(raw));
  } else {
    found = live.find((t) => norm(t.title) === norm(String(raw)));
    if (!found) {
      const partial = live.filter((t) => norm(t.title).includes(norm(String(raw))));
      if (partial.length === 1) found = partial[0];
    }
  }
  if (!found) {
    throw new ToolError(`No topic "${raw}" in ${g.name}. Its topics are: ${live.map((t) => `${t.id} ${t.title}`).join('; ') || 'none yet'}.`);
  }
  return found.id;
}

const MAX_NOTES = 30;

export async function recordStudySessionTool(
  db: Scoped,
  origin: string,
  args: {
    group_id: number;
    summary: string;
    kind?: string;
    minutes?: number;
    started_at?: string;
    topics?: (string | number)[];
    notes?: { body: string; topic?: string | number; lesson_id?: number; exercise_id?: number; resource_id?: number; at?: string | number }[];
    private?: boolean;
    resource_id?: number;
  },
) {
  const g = await memberGroup(db, args.group_id);
  const resourceOf = (id: number | undefined, where: string) => {
    if (id === undefined) return null;
    const r = g.resources.find((x) => x.id === id);
    if (!r) throw new ToolError(`${where}: no video or link ${id} in ${g.name}; get_study_group lists them.`);
    return r;
  };
  const spentOn = resourceOf(args.resource_id, 'resource_id');
  const summary = clean(parseSessionSummary(args.summary));
  if (!summary) throw new ToolError('Give the session a summary: what was worked on, what came of it, what to try next.');
  const kind = clean(parseSessionKind(args.kind));
  const minutes = clean(parseMinutes(args.minutes));
  const startedAt = clean(parseStartedAt(args.started_at));
  const topicIds = (args.topics ?? []).map((t) => topicId(g, t));
  const raw = args.notes ?? [];
  if (raw.length > MAX_NOTES) throw new ToolError(`At most ${MAX_NOTES} notes per session; fold the smaller points into the summary.`);
  const notes = raw.map((n, i) => {
    const body = parseNoteBody(n.body);
    if ('error' in body) throw new ToolError(`Note ${i + 1}: ${body.error}`);
    const lesson = n.lesson_id === undefined ? null : g.lessons.find((l) => l.id === n.lesson_id && l.review !== 'rejected');
    if (n.lesson_id !== undefined && !lesson) throw new ToolError(`Note ${i + 1}: no lesson ${n.lesson_id} in ${g.name}.`);
    const exercise = n.exercise_id === undefined ? null : g.exercises.find((e) => e.id === n.exercise_id && e.review !== 'rejected');
    if (n.exercise_id !== undefined && !exercise) throw new ToolError(`Note ${i + 1}: no exercise ${n.exercise_id} in ${g.name}.`);
    const resource = resourceOf(n.resource_id, `Note ${i + 1}`);
    const at = parseSeconds(n.at);
    if ('error' in at) throw new ToolError(`Note ${i + 1}: ${at.error}`);
    if (at.value !== null && !resource) throw new ToolError(`Note ${i + 1}: a moment needs resource_id, the video it is in.`);
    return {
      resourceId: resource?.id ?? null,
      positionS: at.value,
      body: body.value,
      topicId: n.topic !== undefined ? topicId(g, n.topic) : (lesson?.topicId ?? exercise?.topicId ?? null),
      lessonId: lesson?.id ?? null,
      exerciseId: exercise?.id ?? null,
    };
  });
  const id = await readable(() =>
    createSession(
      db,
      g.id,
      { startedAt, minutes, kind, summary, private: args.private === true, topicIds, resourceId: spentOn?.id ?? null },
      'assistant',
      notes,
    ),
  );
  return {
    recorded: {
      session_id: id,
      group: g.name,
      kind,
      minutes: minutes ?? undefined,
      topics: topicIds.map((t) => g.topics.find((x) => x.id === t)?.title),
      notes: notes.length,
      private: args.private === true || undefined,
    },
    link: `${origin}${tabHref(g.id, 'sessions', `session-${id}`)}`,
    next:
      'Stored as a draft that only the person sees, marked as documented by Claude. Tell them it waits on the Sessions tab, ' +
      'where they can read it, correct it and publish it to the group (or keep it private), or discard it.',
  };
}

export async function listStudyNotesTool(
  db: Scoped,
  origin: string,
  args: { group_id: number; topic?: string | number; member?: string; session_id?: number; limit?: number },
) {
  const g = await getGroup(db, args.group_id);
  if (!g) throw new ToolError(`No study group ${args.group_id} that you belong to. get_study_group without an id lists yours.`);
  const me = db.person.userId;
  const topic = args.topic !== undefined ? topicId(g, args.topic) : null;
  const member = args.member?.trim() ? norm(args.member) : null;
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
  const notes = g.notes.filter(
    (n) =>
      (n.published || n.authorId === me) &&
      (topic === null || n.topicId === topic) &&
      (member === null || norm(n.authorName).includes(member)) &&
      (args.session_id === undefined || n.sessionId === args.session_id),
  );
  const title = (id: number | null, list: { id: number; title: string }[]) => (id === null ? undefined : list.find((x) => x.id === id)?.title);
  return {
    group: g.name,
    total: notes.length,
    notes: notes.slice(0, limit).map((n) => ({
      note_id: n.id,
      author: n.authorName,
      written: n.createdAt,
      topic: title(n.topicId, g.topics),
      lesson: title(n.lessonId, g.lessons),
      exercise: n.exerciseId === null ? undefined : g.exercises.find((e) => e.id === n.exerciseId)?.task,
      session_id: n.sessionId ?? undefined,
      video:
        n.resourceId === null
          ? undefined
          : `${g.resources.find((r) => r.id === n.resourceId)?.title ?? n.resourceId}${n.positionS !== null ? ` at ${formatTime(n.positionS)}` : ''}`,
      text: n.body,
      draft: !n.published || undefined,
      private: n.private || undefined,
      documented_by_claude: n.origin === 'assistant' || undefined,
    })),
    link: `${origin}${tabHref(g.id, 'notes')}`,
    note: 'Newest first. Notes are the members’ own record; drafts and private notes are shown only to their author.',
  };
}

export async function getStudyHistoryTool(db: Scoped, origin: string, args: { group_id: number; weeks?: number; member?: string }) {
  const g = await getGroup(db, args.group_id);
  if (!g) throw new ToolError(`No study group ${args.group_id} that you belong to. get_study_group without an id lists yours.`);
  const weeks = Math.min(Math.max(Math.round(args.weeks ?? 8), 1), 52);
  let memberId: string | undefined;
  if (args.member?.trim()) {
    const asked = norm(args.member);
    const found = g.members.filter((m) => norm(m.name).includes(asked));
    if (found.length !== 1) throw new ToolError(`Name one member: ${g.members.map((m) => m.name).join(', ')}.`);
    memberId = found[0].accountId;
  }
  const h = studyHistory(g, weeks, new Date(), memberId);
  const since = new Date(h.since);
  return {
    group: g.name,
    period: `the last ${weeks} weeks, since ${h.since.slice(0, 10)}`,
    member: memberId ? g.members.find((m) => m.accountId === memberId)?.name : 'everyone',
    sessions: h.sessions,
    minutes: h.minutes,
    by_member: h.members.map((m) => ({ member: m.name, sessions: m.sessions, minutes: m.minutes, sessions_per_week_oldest_first: m.perWeek })),
    by_topic: h.topics.map((t) => ({ topic: t.title, sessions: t.sessions, minutes: t.minutes, last_touched: t.lastTouched?.slice(0, 10) })),
    not_touched: h.neglected,
    sessions_without_topic: h.untagged || undefined,
    recent_sessions: g.sessions
      .filter((x) => x.published && new Date(x.startedAt) >= since && (!memberId || x.authorId === memberId))
      .slice(0, 20)
      .map((x) => ({
        session_id: x.id,
        when: x.startedAt,
        member: x.authorName,
        kind: x.kind,
        minutes: x.minutes ?? undefined,
        topics: x.topicIds.map((t) => g.topics.find((y) => y.id === t)?.title),
        summary: x.summary.length > 400 ? `${x.summary.slice(0, 400)}…` : x.summary,
      })),
    link: `${origin}${tabHref(g.id, 'progress')}`,
    note:
      'Counts published sessions the person can see; minutes of a session are split evenly over the topics it touched. ' +
      'list_study_notes gives the notes behind a session or topic.',
  };
}

export async function addStudyResourceTool(
  db: Scoped,
  origin: string,
  args: { group_id: number; url: string; title?: string; why?: string; topics?: (string | number)[] },
) {
  const g = await memberGroup(db, args.group_id);
  const title = clean(parseResourceTitle(args.title ?? ''));
  const why = clean(parseResourceWhy(args.why ?? ''));
  const topicIds = (args.topics ?? []).map((t) => topicId(g, t));
  const input = await readable(() => resourceFromUrl(args.url, { title, why, topicIds }));
  const id = await readable(() => addResource(db, g.id, input, 'assistant'));
  return {
    added: { resource_id: id, kind: input.kind, title: input.title, channel: input.channel || undefined, topics: topicIds.length || undefined },
    link: `${origin}${resourceHref(g.id, id)}`,
    next:
      'Stored as a draft only the person sees, marked as added by Claude. Tell them it waits on the Resources tab to publish or discard. ' +
      'Notes can now point at moments in it (record_study_session notes with resource_id and at).',
  };
}

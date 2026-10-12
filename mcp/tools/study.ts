// The Learning section on the connector (REQUIREMENTS §10, M-2, M-3, M-4):
// get_study_group reads a group's syllabus, proposals and progress;
// draft_topic, draft_lesson and draft_exercise propose syllabus entries,
// stored as written by the assistant and unreviewed, in the connected
// person's name, until the group's custodian accepts or rejects them. A
// lesson's citation markers are checked against the page text before it is
// stored, and one that fails refuses the whole lesson. Nothing here edits or
// deletes.

import type { Scoped } from '@/lib/db';
import { listModels } from '@/lib/gear';
import { addExercise, addLesson, addTopic, checkCitations, getGroup, groupOf, listMyGroups, StudyError } from '@/lib/study';
import { parseExerciseDone, parseLessonBody, parseLessonTitle, parseTask, parseTopicSummary, parseTopicTitle } from '@/lib/studyInput';
import { lessonHref, type StudyGroup } from '@/lib/studyTypes';
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
    documents: g.documents
      .filter((d) => d.sharedWithGroup || d.citedBy > 0)
      .map((d) => ({
        id: d.id,
        title: titles.get(d.id) ?? '(not readable by you)',
        shared_with_group: d.sharedWithGroup,
        cited_in_lessons: d.citedBy,
      })),
    note:
      'Topics, lessons and exercises under awaiting_review are proposals, not the group’s syllabus, until the custodian accepts them. ' +
      'Pass topic (a topic_id) to include the full text of that topic’s lessons. Progress is each member’s own record.',
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

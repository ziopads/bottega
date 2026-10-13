import { CITATION_SPAN_MAX, citationLabel, parseCitations, quoteFound } from '@/lib/citations';
import type { Scoped } from '@/lib/db';
import { accountNames, nameOf } from '@/lib/names';
import type {
  PendingInvitation,
  Review,
  StudyDocument,
  StudyExercise,
  StudyGroup,
  StudyGroupSummary,
  StudyInvitation,
  StudyLesson,
  StudyMember,
  SessionKind,
  StudyNote,
  StudyProgressStatus,
  StudySession,
  StudyTopic,
} from '@/lib/studyTypes';

// The Learning section's data layer (REQUIREMENTS §10, db/016): study groups,
// invitations and membership, the syllabus with Claude's proposals, each
// member's progress, and documents shared with a group. Server only. Every
// statement runs as the person; db/016's policies and functions decide who
// may do what, and the refusals they raise on purpose are passed on to be
// shown.

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

/** A refusal a person (or Claude) can read. */
export class StudyError extends Error {}

const READABLE =
  /only an approved library manual|publishes it|stays published|session's topics belong|note's (session|topic|lesson|exercise)|stays with its group|custodian|already|no approved account|not a member|no invitation of yours|has already been answered|group is closed|accept its topic first|same topic|stays|only a proposal|open or closed|not shared; they are visible|cannot leave/;

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? '';
    const code = (err as { code?: string })?.code;
    if (code === '23505' && /study_groups_name/.test(msg)) throw new StudyError('A group with that name already exists.');
    if (code === '23505' && /study_group_documents/.test(msg)) throw new StudyError('That document is already shared with the group.');
    if (READABLE.test(msg)) throw new StudyError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
    if (/row-level security|permission denied/.test(msg)) throw new StudyError('Your place in this group does not allow that.');
    if (/violates check constraint/.test(msg)) throw new StudyError('That is missing something it needs, or is too long.');
    throw err;
  }
}

const review = (r: Row): Review => (r.rejected_at !== null && r.rejected_at !== undefined ? 'rejected' : r.reviewed === true ? 'accepted' : 'proposed');

// ── Reading ──────────────────────────────────────────────────────────────────

/** The groups the person belongs to, and the invitations waiting for them. */
export async function listMyGroups(db: Scoped): Promise<{ groups: StudyGroupSummary[]; invitations: StudyInvitation[] }> {
  const [groupRows, inviteRows] = await db.tx([
    {
      text: `select g.id, g.name, g.description, g.status, g.custodian_id,
                    (select count(*) from study_group_members m where m.group_id = g.id) as members,
                    (select count(*) from study_topics t where t.group_id = g.id and t.reviewed and t.rejected_at is null) as topics,
                    ((select count(*) from study_topics t where t.group_id = g.id and not t.reviewed and t.rejected_at is null)
                     + (select count(*) from study_lessons l join study_topics t on t.id = l.topic_id
                         where t.group_id = g.id and not l.reviewed and l.rejected_at is null)
                     + (select count(*) from study_exercises e join study_topics t on t.id = e.topic_id
                         where t.group_id = g.id and not e.reviewed and e.rejected_at is null)) as waiting
               from study_groups g
              where study_member(g.id)
              order by lower(g.name)`,
    },
    {
      text: `select i.id, i.group_id, g.name, i.invited_by, i.created_at
               from study_group_invitations i join study_groups g on g.id = i.group_id
              where i.account_id = app_user() and i.status = 'pending'
              order by i.created_at desc`,
    },
  ]);
  const who = await accountNames(db, [...groupRows.map((r) => str(r.custodian_id)), ...inviteRows.map((r) => str(r.invited_by))]);
  return {
    groups: groupRows.map((r) => ({
      id: num(r.id),
      name: str(r.name),
      description: str(r.description),
      status: r.status === 'closed' ? 'closed' : 'open',
      custodianId: str(r.custodian_id),
      custodianName: nameOf(who, str(r.custodian_id)),
      memberCount: num(r.members),
      topicCount: num(r.topics),
      waiting: num(r.waiting),
    })),
    invitations: inviteRows.map((r) => ({
      id: num(r.id),
      groupId: num(r.group_id),
      groupName: str(r.name),
      invitedByName: nameOf(who, str(r.invited_by)),
      createdAt: iso(r.created_at),
    })),
  };
}

/** One group with its whole syllabus, or null when the person is not a member. */
export async function getGroup(db: Scoped, groupId: number): Promise<StudyGroup | null> {
  const [groupRows, memberRows, inviteRows, topicRows, lessonRows, exerciseRows, progressRows, sharedRows, sessionRows, noteRows] = await db.tx([
    {
      text: `select id, name, description, status, custodian_id, created_at from study_groups where id = $1 and study_member(id)`,
      params: [groupId],
    },
    { text: 'select account_id, how, joined_at from study_group_members where group_id = $1 order by joined_at', params: [groupId] },
    {
      text: `select id, account_id, created_at from study_group_invitations
              where group_id = $1 and status = 'pending' and study_custodian(group_id) order by created_at`,
      params: [groupId],
    },
    {
      text: `select t.id, t.title, t.summary, t.position, t.origin, t.reviewed, t.rejected_at, t.created_by, t.created_at,
                    m.id as model_id, m.manufacturer, m.model
               from study_topics t left join gear_models m on m.id = t.model_id
              where t.group_id = $1 order by t.position, t.id`,
      params: [groupId],
    },
    {
      text: `select l.id, l.topic_id, l.title, l.body, l.position, l.origin, l.reviewed, l.rejected_at, l.created_by, l.created_at, l.updated_at
               from study_lessons l join study_topics t on t.id = l.topic_id
              where t.group_id = $1 order by l.position, l.id`,
      params: [groupId],
    },
    {
      text: `select e.id, e.topic_id, e.lesson_id, e.task, e.done_when, e.position, e.origin, e.reviewed, e.rejected_at, e.created_by, e.created_at
               from study_exercises e join study_topics t on t.id = e.topic_id
              where t.group_id = $1 order by e.position, e.id`,
      params: [groupId],
    },
    {
      text: `select p.exercise_id, p.account_id, p.status, p.note, p.updated_at
               from study_progress p join study_exercises e on e.id = p.exercise_id join study_topics t on t.id = e.topic_id
              where t.group_id = $1`,
      params: [groupId],
    },
    { text: 'select document_id from study_group_documents where group_id = $1', params: [groupId] },
    {
      text: `select s.id, s.author_id, s.started_at, s.minutes, s.kind, s.summary, s.private, s.origin, s.published, s.created_at,
                    coalesce((select array_agg(st.topic_id order by st.topic_id) from study_session_topics st where st.session_id = s.id), '{}') as topic_ids
               from study_sessions s where s.group_id = $1 order by s.started_at desc, s.id desc`,
      params: [groupId],
    },
    {
      text: `select id, author_id, session_id, topic_id, lesson_id, exercise_id, body, private, origin, published, created_at, updated_at
               from study_notes where group_id = $1 order by created_at desc, id desc`,
      params: [groupId],
    },
  ]);
  if (!groupRows.length) return null;
  const g = groupRows[0];
  const who = await accountNames(db, [
    str(g.custodian_id),
    ...memberRows.map((r) => str(r.account_id)),
    ...inviteRows.map((r) => str(r.account_id)),
    ...topicRows.map((r) => str(r.created_by)),
    ...lessonRows.map((r) => str(r.created_by)),
    ...exerciseRows.map((r) => str(r.created_by)),
    ...progressRows.map((r) => str(r.account_id)),
    ...sessionRows.map((r) => str(r.author_id)),
    ...noteRows.map((r) => str(r.author_id)),
  ]);

  const members: StudyMember[] = memberRows.map((r) => ({
    accountId: str(r.account_id),
    name: nameOf(who, str(r.account_id)),
    how: str(r.how) as StudyMember['how'],
    joinedAt: iso(r.joined_at),
  }));
  const invitations: PendingInvitation[] = inviteRows.map((r) => ({
    id: num(r.id),
    accountId: str(r.account_id),
    name: nameOf(who, str(r.account_id)),
    createdAt: iso(r.created_at),
  }));
  const topics: StudyTopic[] = topicRows.map((r) => ({
    id: num(r.id),
    title: str(r.title),
    summary: str(r.summary),
    model: r.model_id === null ? null : { id: num(r.model_id), manufacturer: str(r.manufacturer), model: str(r.model) },
    position: num(r.position),
    origin: r.origin === 'assistant' ? 'assistant' : 'human',
    review: review(r),
    createdByName: nameOf(who, str(r.created_by)),
    createdAt: iso(r.created_at),
  }));
  const lessons: StudyLesson[] = lessonRows.map((r) => ({
    id: num(r.id),
    topicId: num(r.topic_id),
    title: str(r.title),
    body: str(r.body),
    position: num(r.position),
    origin: r.origin === 'assistant' ? 'assistant' : 'human',
    review: review(r),
    createdByName: nameOf(who, str(r.created_by)),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }));
  const progressBy = new Map<number, StudyExercise['progress']>();
  for (const r of progressRows) {
    const list = progressBy.get(num(r.exercise_id)) ?? [];
    list.push({
      accountId: str(r.account_id),
      name: nameOf(who, str(r.account_id)),
      status: str(r.status) as StudyProgressStatus,
      note: str(r.note),
      updatedAt: iso(r.updated_at),
    });
    progressBy.set(num(r.exercise_id), list);
  }
  const exercises: StudyExercise[] = exerciseRows.map((r) => ({
    id: num(r.id),
    topicId: num(r.topic_id),
    lessonId: numOrNull(r.lesson_id),
    task: str(r.task),
    doneWhen: str(r.done_when),
    position: num(r.position),
    origin: r.origin === 'assistant' ? 'assistant' : 'human',
    review: review(r),
    createdByName: nameOf(who, str(r.created_by)),
    createdAt: iso(r.created_at),
    progress: progressBy.get(num(r.id)) ?? [],
  }));

  const sessions: StudySession[] = sessionRows.map((r) => ({
    id: num(r.id),
    authorId: str(r.author_id),
    authorName: nameOf(who, str(r.author_id)),
    startedAt: iso(r.started_at),
    minutes: numOrNull(r.minutes),
    kind: str(r.kind) as SessionKind,
    summary: str(r.summary),
    private: r.private === true,
    origin: r.origin === 'assistant' ? 'assistant' : 'human',
    published: r.published === true,
    topicIds: ((r.topic_ids as unknown[]) ?? []).map(num),
    createdAt: iso(r.created_at),
  }));
  const notes: StudyNote[] = noteRows.map((r) => ({
    id: num(r.id),
    authorId: str(r.author_id),
    authorName: nameOf(who, str(r.author_id)),
    sessionId: numOrNull(r.session_id),
    topicId: numOrNull(r.topic_id),
    lessonId: numOrNull(r.lesson_id),
    exerciseId: numOrNull(r.exercise_id),
    body: str(r.body),
    private: r.private === true,
    origin: r.origin === 'assistant' ? 'assistant' : 'human',
    published: r.published === true,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }));

  // Documents: those the lessons cite (proposals included, for their titles)
  // and those shared with the group.
  const shared = new Set(sharedRows.map((r) => num(r.document_id)));
  const citedBy = new Map<number, Set<number>>();
  const mentioned = new Set<number>();
  for (const l of lessons) {
    if (l.review === 'rejected') continue;
    for (const c of parseCitations(l.body)) {
      mentioned.add(c.documentId);
      if (l.review !== 'accepted') continue;
      const set = citedBy.get(c.documentId) ?? new Set<number>();
      set.add(l.id);
      citedBy.set(c.documentId, set);
    }
  }
  for (const text of [...sessions.map((x) => x.summary), ...notes.map((x) => x.body)]) {
    for (const c of parseCitations(text)) mentioned.add(c.documentId);
  }
  const docIds = Array.from(new Set([...shared, ...mentioned]));
  const docRows = docIds.length
    ? await db.q(
        'select id, title, owner_id, library, manufacturer, model, pages_done, page_count from documents where id = any($1::bigint[])',
        [docIds],
      )
    : [];
  const readable = new Map(docRows.map((r) => [num(r.id), r]));
  const documents: StudyDocument[] = docIds
    .map((id) => {
      const r = readable.get(id);
      return {
        id,
        title: r ? str(r.title) : null,
        library: r ? r.library === true : false,
        about: r ? [str(r.manufacturer), str(r.model)].filter(Boolean).join(' ') : '',
        pagesDone: r ? num(r.pages_done) : 0,
        pageCount: r ? numOrNull(r.page_count) : null,
        sharedWithGroup: shared.has(id),
        mine: r ? str(r.owner_id) === db.person.userId : false,
        citedBy: citedBy.get(id)?.size ?? 0,
      };
    })
    .sort((a, b) => (a.title ?? '￿').localeCompare(b.title ?? '￿'));

  return {
    id: num(g.id),
    name: str(g.name),
    description: str(g.description),
    status: g.status === 'closed' ? 'closed' : 'open',
    custodianId: str(g.custodian_id),
    custodianName: nameOf(who, str(g.custodian_id)),
    createdAt: iso(g.created_at),
    members,
    invitations,
    topics,
    lessons,
    exercises,
    documents,
    sessions,
    notes,
  };
}

/** The group a topic, lesson or exercise belongs to, or null when the person cannot see it. */
export async function groupOf(db: Scoped, kind: 'topic' | 'lesson' | 'exercise' | 'invitation' | 'session' | 'note', id: number): Promise<number | null> {
  const sql = {
    topic: 'select group_id from study_topics where id = $1',
    lesson: 'select t.group_id from study_lessons l join study_topics t on t.id = l.topic_id where l.id = $1',
    exercise: 'select t.group_id from study_exercises e join study_topics t on t.id = e.topic_id where e.id = $1',
    invitation: 'select group_id from study_group_invitations where id = $1',
    session: 'select group_id from study_sessions where id = $1',
    note: 'select group_id from study_notes where id = $1',
  }[kind];
  const rows = await db.q(sql, [id]);
  return rows.length ? num(rows[0].group_id) : null;
}

/**
 * For the document page: the groups whose reading list the person may change
 * for this document (their own private document: every group they belong
 * to; a library manual: the groups they keep as custodian), and whether it is
 * on each list.
 */
export async function documentGroups(db: Scoped, documentId: number): Promise<{ id: number; name: string; shared: boolean }[]> {
  const rows = await db.q(
    `select g.id, g.name, exists (select 1 from study_group_documents s where s.group_id = g.id and s.document_id = $1) as shared
       from study_groups g
      where study_member(g.id) and (not document_is_library($1) or study_custodian(g.id))
      order by lower(g.name)`,
    [documentId],
  );
  return rows.map((r) => ({ id: num(r.id), name: str(r.name), shared: r.shared === true }));
}

// ── Citations ────────────────────────────────────────────────────────────────

/**
 * Checks every citation marker in a lesson body against the corpus as this
 * person can read it: the document exists and is readable, the pages exist
 * and have been read, and each quotation is on the pages cited. Returns the
 * problems, one line each; an empty list means the body may be saved.
 */
export async function checkCitations(db: Scoped, body: string): Promise<string[]> {
  const citations = parseCitations(body);
  if (!citations.length) return [];
  const problems: string[] = [];
  const ids = Array.from(new Set(citations.map((c) => c.documentId)));
  const docs = await db.q('select id, title, page_count from documents where id = any($1::bigint[])', [ids]);
  const byId = new Map(docs.map((d) => [num(d.id), d]));
  const wanted: { id: number; pages: number[] }[] = [];
  for (const c of citations) {
    const d = byId.get(c.documentId);
    if (!d) {
      problems.push(`${c.raw}: no document ${c.documentId} that you can read.`);
      continue;
    }
    const total = numOrNull(d.page_count);
    if (c.to < c.from || c.from < 1) problems.push(`${c.raw}: the pages run backwards.`);
    else if (c.to - c.from + 1 > CITATION_SPAN_MAX) problems.push(`${c.raw}: cite at most ${CITATION_SPAN_MAX} pages in one marker.`);
    else if (total !== null && c.to > total) problems.push(`${c.raw}: ${str(d.title)} has ${total} pages.`);
    else wanted.push({ id: c.documentId, pages: Array.from({ length: c.to - c.from + 1 }, (_, i) => c.from + i) });
  }
  if (!wanted.length) return problems;
  const pairs = wanted.flatMap((w) => w.pages.map((p) => [w.id, p] as const));
  const pageRows = await db.q(
    `select document_id, page_number, text from pages
      where (document_id, page_number) in (select * from unnest($1::bigint[], $2::int[]))`,
    [pairs.map((p) => p[0]), pairs.map((p) => p[1])],
  );
  const text = new Map(pageRows.map((r) => [`${num(r.document_id)}:${num(r.page_number)}`, str(r.text)]));
  for (const c of citations) {
    const d = byId.get(c.documentId);
    if (!d || c.to < c.from || c.from < 1 || c.to - c.from + 1 > CITATION_SPAN_MAX) continue;
    const pages = Array.from({ length: c.to - c.from + 1 }, (_, i) => text.get(`${c.documentId}:${c.from + i}`));
    if (pages.some((p) => p === undefined)) {
      problems.push(`${c.raw}: ${citationLabel(c)} of ${str(d.title)} has not been read yet; processing reads it.`);
      continue;
    }
    if (c.quote && !quoteFound(pages.join('\n'), c.quote)) {
      problems.push(`${c.raw}: the quotation is not on ${citationLabel(c)} of ${str(d.title)}. Copy it exactly from the page.`);
    }
  }
  return problems;
}

async function citationsOk(db: Scoped, body: string) {
  const problems = await checkCitations(db, body);
  if (problems.length) throw new StudyError(`Citations to fix: ${problems.join(' ')}`);
}

// ── Groups and membership ────────────────────────────────────────────────────

export async function createGroup(db: Scoped, name: string, description: string): Promise<number> {
  const rows = await run(() =>
    db.q('insert into study_groups (name, description) values ($1, $2) returning id', [name, description]),
  );
  return num(rows[0].id);
}

export async function updateGroup(db: Scoped, groupId: number, patch: { name?: string; description?: string }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [groupId];
  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description);
    sets.push(`description = $${params.length}`);
  }
  if (!sets.length) return;
  const rows = await run(() => db.q(`update study_groups set ${sets.join(', ')} where id = $1 returning id`, params));
  if (!rows.length) throw new StudyError('Only the group’s custodian changes its name and description.');
}

export const invite = (db: Scoped, groupId: number, email: string) =>
  run(() => db.q('select study_group_invite($1, $2)', [groupId, email]));
export const answerInvitation = (db: Scoped, invitationId: number, accept: boolean) =>
  run(() => db.q('select study_invitation_answer($1, $2)', [invitationId, accept]));
export const withdrawInvitation = (db: Scoped, invitationId: number) =>
  run(() => db.q('select study_invitation_withdraw($1)', [invitationId]));
export const leaveGroup = (db: Scoped, groupId: number) => run(() => db.q('select study_group_leave($1)', [groupId]));
export const removeMember = (db: Scoped, groupId: number, accountId: string) =>
  run(() => db.q('select study_group_remove($1, $2)', [groupId, accountId]));
export const setGroupStatus = (db: Scoped, groupId: number, status: 'open' | 'closed') =>
  run(() => db.q('select study_group_set_status($1, $2)', [groupId, status]));

// ── The syllabus ─────────────────────────────────────────────────────────────

export type Origin = 'human' | 'assistant';
const reviewedFor = (origin: Origin) => origin === 'human';

export async function addTopic(
  db: Scoped,
  groupId: number,
  t: { title: string; summary: string; modelId: number | null },
  origin: Origin,
): Promise<number> {
  const rows = await run(() =>
    db.q(
      `insert into study_topics (group_id, title, summary, model_id, origin, reviewed) values ($1, $2, $3, $4, $5, $6) returning id`,
      [groupId, t.title, t.summary, t.modelId, origin, reviewedFor(origin)],
    ),
  );
  return num(rows[0].id);
}

export async function addLesson(db: Scoped, topicId: number, l: { title: string; body: string }, origin: Origin): Promise<number> {
  await citationsOk(db, l.body);
  const rows = await run(() =>
    db.q(`insert into study_lessons (topic_id, title, body, origin, reviewed) values ($1, $2, $3, $4, $5) returning id`, [
      topicId,
      l.title,
      l.body,
      origin,
      reviewedFor(origin),
    ]),
  );
  return num(rows[0].id);
}

export async function addExercise(
  db: Scoped,
  topicId: number,
  e: { task: string; doneWhen: string; lessonId: number | null },
  origin: Origin,
): Promise<number> {
  const rows = await run(() =>
    db.q(
      `insert into study_exercises (topic_id, lesson_id, task, done_when, origin, reviewed) values ($1, $2, $3, $4, $5, $6) returning id`,
      [topicId, e.lessonId, e.task, e.doneWhen, origin, reviewedFor(origin)],
    ),
  );
  return num(rows[0].id);
}

type Table = 'study_topics' | 'study_lessons' | 'study_exercises';
const TABLE: Record<'topic' | 'lesson' | 'exercise', Table> = { topic: 'study_topics', lesson: 'study_lessons', exercise: 'study_exercises' };
const COLUMNS: Record<Table, Record<string, string>> = {
  study_topics: { title: 'title', summary: 'summary', modelId: 'model_id' },
  study_lessons: { title: 'title', body: 'body' },
  study_exercises: { task: 'task', doneWhen: 'done_when', lessonId: 'lesson_id' },
};

/** Changes fields of one syllabus entry (the custodian's to do). */
export async function updateEntry(db: Scoped, kind: 'topic' | 'lesson' | 'exercise', id: number, patch: Record<string, unknown>): Promise<void> {
  const table = TABLE[kind];
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, column] of Object.entries(COLUMNS[table])) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (!sets.length) return;
  if (kind === 'lesson' && typeof patch.body === 'string') await citationsOk(db, patch.body);
  const rows = await run(() => db.q(`update ${table} set ${sets.join(', ')} where id = $1 returning id`, params));
  if (!rows.length) throw new StudyError('Only the group’s custodian changes the syllabus, and only while the group is open.');
}

/** Accepts or rejects one of Claude's proposals. */
export async function reviewEntry(db: Scoped, kind: 'topic' | 'lesson' | 'exercise', id: number, accept: boolean): Promise<void> {
  const table = TABLE[kind];
  const rows = await run(() =>
    db.q(
      accept
        ? `update ${table} set reviewed = true where id = $1 and not reviewed and rejected_at is null returning id`
        : `update ${table} set rejected_at = now() where id = $1 and not reviewed and rejected_at is null returning id`,
      [id],
    ),
  );
  if (!rows.length) throw new StudyError('That proposal is not waiting, or reviewing it is the custodian’s to do.');
}

/** Moves an entry one place up or down among its siblings (topics in the group; lessons or exercises in a topic). */
export async function moveEntry(db: Scoped, kind: 'topic' | 'lesson' | 'exercise', id: number, direction: 'up' | 'down'): Promise<void> {
  const table = TABLE[kind];
  const parent = kind === 'topic' ? 'group_id' : 'topic_id';
  const rows = await db.q(`select id, position from ${table} where ${parent} = (select ${parent} from ${table} where id = $1) order by position, id`, [id]);
  const list = rows.map((r) => ({ id: num(r.id), position: num(r.position) }));
  const at = list.findIndex((r) => r.id === id);
  const other = list[direction === 'up' ? at - 1 : at + 1];
  if (at < 0 || !other) return;
  // Renumber the whole list, so equal positions never leave a move undone.
  const order = list.map((r) => r.id);
  [order[at], order[direction === 'up' ? at - 1 : at + 1]] = [order[direction === 'up' ? at - 1 : at + 1], order[at]];
  const results = await run(() =>
    db.tx(order.map((rid, i) => ({ text: `update ${table} set position = $2 where id = $1 returning id`, params: [rid, i + 1] }))),
  );
  if (results.some((r) => !r.length)) throw new StudyError('Only the group’s custodian reorders the syllabus.');
}

// ── Progress ─────────────────────────────────────────────────────────────────

export async function setProgress(db: Scoped, exerciseId: number, status: StudyProgressStatus, note: string): Promise<void> {
  await run(() =>
    db.q(
      `insert into study_progress (exercise_id, status, note) values ($1, $2, $3)
       on conflict (exercise_id, account_id) do update set status = excluded.status, note = excluded.note`,
      [exerciseId, status, note],
    ),
  );
}

// ── Documents shared with a group ────────────────────────────────────────────

export async function shareWithGroup(db: Scoped, documentId: number, groupId: number): Promise<void> {
  await run(() => db.q('insert into study_group_documents (group_id, document_id) values ($1, $2)', [groupId, documentId]));
}

export async function unshareFromGroup(db: Scoped, documentId: number, groupId: number): Promise<void> {
  const rows = await run(() =>
    db.q('delete from study_group_documents where group_id = $1 and document_id = $2 returning group_id', [groupId, documentId]),
  );
  if (!rows.length) throw new StudyError('Only the document’s owner, or for a library manual the group’s custodian, takes it off the list.');
}

// ── Sessions and notes (db/017) ──────────────────────────────────────────────

export interface NoteInput {
  body: string;
  topicId?: number | null;
  lessonId?: number | null;
  exerciseId?: number | null;
  private?: boolean;
}

export interface SessionInput {
  startedAt: string | null;
  minutes: number | null;
  kind: SessionKind;
  summary: string;
  private: boolean;
  topicIds: number[];
}

const SESSION_ID = `currval(pg_get_serial_sequence('study_sessions', 'id'))`;

/**
 * Stores a session with its topics and, optionally, its notes, in one
 * transaction. Origin 'assistant' (the connector) makes it a draft that only
 * its author sees until they publish it. Citations in the summary and the
 * notes are checked first. Returns the session's id.
 */
export async function createSession(db: Scoped, groupId: number, s: SessionInput, origin: Origin, notes: NoteInput[] = []): Promise<number> {
  for (const text of [s.summary, ...notes.map((n) => n.body)]) await citationsOk(db, text);
  const results = await run(() =>
    db.tx([
      {
        text: `insert into study_sessions (group_id, started_at, minutes, kind, summary, private, origin)
               values ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6, $7) returning id`,
        params: [groupId, s.startedAt, s.minutes, s.kind, s.summary, s.private, origin],
      },
      {
        text: `insert into study_session_topics (session_id, topic_id) select ${SESSION_ID}, t from unnest($1::bigint[]) as t`,
        params: [Array.from(new Set(s.topicIds))],
      },
      ...notes.map((n) => ({
        text: `insert into study_notes (group_id, session_id, topic_id, lesson_id, exercise_id, body, private, origin)
               values ($1, ${SESSION_ID}, $2, $3, $4, $5, $6, $7)`,
        params: [groupId, n.topicId ?? null, n.lessonId ?? null, n.exerciseId ?? null, n.body, n.private ?? false, origin],
      })),
    ]),
  );
  return num(results[0][0].id);
}

export async function updateSession(db: Scoped, id: number, patch: Partial<SessionInput>): Promise<void> {
  if (typeof patch.summary === 'string') await citationsOk(db, patch.summary);
  const cols: Record<string, string> = { startedAt: 'started_at', minutes: 'minutes', kind: 'kind', summary: 'summary', private: 'private' };
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, col] of Object.entries(cols)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  }
  const statements = [
    { text: `update study_sessions set ${sets.length ? sets.join(', ') : 'summary = summary'} where id = $1 returning id`, params },
  ];
  if (patch.topicIds) {
    statements.push(
      { text: 'delete from study_session_topics where session_id = $1 returning session_id', params: [id] },
      {
        text: 'insert into study_session_topics (session_id, topic_id) select $1, t from unnest($2::bigint[]) as t returning session_id',
        params: [id, Array.from(new Set(patch.topicIds))],
      },
    );
  }
  const results = await run(() => db.tx(statements));
  if (!results[0].length) throw new StudyError('Only the session’s author changes it, and only while the group is open.');
}

export async function publishSession(db: Scoped, id: number): Promise<void> {
  await run(() => db.q('select study_session_publish($1)', [id]));
}

/** Discards one of the person's own drafts, with its notes. */
export async function discardSession(db: Scoped, id: number): Promise<void> {
  const rows = await run(() => db.q('delete from study_sessions where id = $1 returning id', [id]));
  if (!rows.length) throw new StudyError('Only a draft can be discarded, by its author.');
}

export async function addNote(db: Scoped, groupId: number, n: NoteInput & { sessionId?: number | null }, origin: Origin): Promise<number> {
  await citationsOk(db, n.body);
  const rows = await run(() =>
    db.q(
      `insert into study_notes (group_id, session_id, topic_id, lesson_id, exercise_id, body, private, origin)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [groupId, n.sessionId ?? null, n.topicId ?? null, n.lessonId ?? null, n.exerciseId ?? null, n.body, n.private ?? false, origin],
    ),
  );
  return num(rows[0].id);
}

export async function updateNote(db: Scoped, id: number, patch: Partial<NoteInput>): Promise<void> {
  if (typeof patch.body === 'string') await citationsOk(db, patch.body);
  const cols: Record<string, string> = { body: 'body', topicId: 'topic_id', lessonId: 'lesson_id', exerciseId: 'exercise_id', private: 'private' };
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, col] of Object.entries(cols)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return;
  const rows = await run(() => db.q(`update study_notes set ${sets.join(', ')} where id = $1 returning id`, params));
  if (!rows.length) throw new StudyError('Only the note’s author changes it, and only while the group is open.');
}

/** Discards one of the person's own draft notes. */
export async function discardNote(db: Scoped, id: number): Promise<void> {
  const rows = await run(() => db.q('delete from study_notes where id = $1 returning id', [id]));
  if (!rows.length) throw new StudyError('Only a draft note can be discarded, by its author.');
}

// Types and limits for the Learning section (REQUIREMENTS §10, db/016). A
// plain module: server and client components both import it.

export const STUDY_PROGRESS = ['not started', 'practising', 'done'] as const;
export type StudyProgressStatus = (typeof STUDY_PROGRESS)[number];

export const GROUP_NAME_MAX = 80;
export const GROUP_DESCRIPTION_MAX = 1000;
export const TOPIC_TITLE_MAX = 120;
export const TOPIC_SUMMARY_MAX = 1000;
export const LESSON_TITLE_MAX = 160;
export const LESSON_BODY_MAX = 20000;
export const EXERCISE_TASK_MAX = 2000;
export const EXERCISE_DONE_MAX = 1000;
export const PROGRESS_NOTE_MAX = 500;
export const SESSION_SUMMARY_MAX = 8000;
export const NOTE_BODY_MAX = 10000;

/** The group page's tabs, in the address as ?tab= (the syllabus when absent). */
export const GROUP_TABS = ['syllabus', 'sessions', 'notes', 'resources', 'progress'] as const;
export type GroupTab = (typeof GROUP_TABS)[number];
export const GROUP_TAB_LABEL: Record<GroupTab, string> = {
  syllabus: 'Syllabus',
  sessions: 'Sessions',
  notes: 'Notes',
  resources: 'Resources',
  progress: 'Progress',
};

export const SESSION_KINDS = ['at the instrument', 'conversation', 'reading', 'video', 'other'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
export const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  'at the instrument': 'At the instrument',
  conversation: 'Conversation',
  reading: 'Reading',
  video: 'Watching',
  other: 'Other',
};

/** A syllabus entry's standing: the custodian's, accepted, waiting for review, or rejected. */
export type Review = 'accepted' | 'proposed' | 'rejected';

export interface StudyGroupSummary {
  id: number;
  name: string;
  description: string;
  status: 'open' | 'closed';
  custodianId: string;
  custodianName: string;
  memberCount: number;
  topicCount: number;
  /** Proposals waiting for the custodian. */
  waiting: number;
}

export interface StudyInvitation {
  id: number;
  groupId: number;
  groupName: string;
  invitedByName: string;
  createdAt: string;
}

export interface StudyMember {
  accountId: string;
  name: string;
  how: 'created' | 'invited' | 'requested';
  joinedAt: string;
}

export interface PendingInvitation {
  id: number;
  accountId: string;
  name: string;
  createdAt: string;
}

export interface StudyModel {
  id: number;
  manufacturer: string;
  model: string;
}

export interface StudyTopic {
  id: number;
  title: string;
  summary: string;
  model: StudyModel | null;
  position: number;
  origin: 'human' | 'assistant';
  review: Review;
  createdByName: string;
  createdAt: string;
}

export interface StudyLesson {
  id: number;
  topicId: number;
  title: string;
  body: string;
  position: number;
  origin: 'human' | 'assistant';
  review: Review;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudyProgress {
  accountId: string;
  name: string;
  status: StudyProgressStatus;
  note: string;
  updatedAt: string;
}

export interface StudyExercise {
  id: number;
  topicId: number;
  lessonId: number | null;
  task: string;
  doneWhen: string;
  position: number;
  origin: 'human' | 'assistant';
  review: Review;
  createdByName: string;
  createdAt: string;
  /** Every member's progress that has been recorded. */
  progress: StudyProgress[];
}

/** A document on the group's reading list (019), or one its lessons, sessions or notes cite. */
export interface StudyDocument {
  id: number;
  /** Null when the viewer cannot read it. */
  title: string | null;
  /** A library manual (listed by the custodian), or a private document (shared by its owner). */
  library: boolean;
  /** "Akai MPC One", when known. */
  about: string;
  /** Pages searchable so far, and in all. */
  pagesDone: number;
  pageCount: number | null;
  /** On the group's reading list: searched by Claude for the group, readable by every member. */
  sharedWithGroup: boolean;
  /** The viewer owns it, so may share it with the group or stop sharing it. */
  mine: boolean;
  /** Accepted lessons citing it. */
  citedBy: number;
}

/** One member's sitting (db/017). A draft (Claude's, unpublished) is seen by its author only. */
export interface StudySession {
  id: number;
  authorId: string;
  authorName: string;
  startedAt: string;
  minutes: number | null;
  kind: SessionKind;
  summary: string;
  private: boolean;
  origin: 'human' | 'assistant';
  published: boolean;
  topicIds: number[];
  /** The video or link the session was spent on (020). */
  resourceId: number | null;
  createdAt: string;
}

/** A video (YouTube, played in the app) or a link a member added to the group (db/020). */
export interface StudyResource {
  id: number;
  kind: 'video' | 'link';
  url: string;
  youtubeId: string | null;
  title: string;
  channel: string;
  thumbnailUrl: string;
  why: string;
  addedById: string;
  addedByName: string;
  origin: 'human' | 'assistant';
  /** False for Claude's draft, seen only by the member it acted for. */
  published: boolean;
  topicIds: number[];
  createdAt: string;
}

export const RESOURCE_WHY_MAX = 1000;
export const resourceHref = (groupId: number, resourceId: number, at?: number | null) =>
  `/learning/${groupId}/resources/${resourceId}${at !== undefined && at !== null ? `?t=${Math.floor(at)}` : ''}`;

/** A member's note, alone or in one of their sessions (db/017). */
export interface StudyNote {
  id: number;
  authorId: string;
  authorName: string;
  sessionId: number | null;
  topicId: number | null;
  lessonId: number | null;
  exerciseId: number | null;
  /** A video and the moment in it the note is about (020). */
  resourceId: number | null;
  positionS: number | null;
  body: string;
  private: boolean;
  origin: 'human' | 'assistant';
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudyGroup {
  id: number;
  name: string;
  description: string;
  status: 'open' | 'closed';
  custodianId: string;
  custodianName: string;
  createdAt: string;
  members: StudyMember[];
  /** For the custodian only. */
  invitations: PendingInvitation[];
  topics: StudyTopic[];
  lessons: StudyLesson[];
  exercises: StudyExercise[];
  documents: StudyDocument[];
  /** Newest first: the viewer's own (drafts included) and others' published, shared ones. */
  sessions: StudySession[];
  notes: StudyNote[];
  /** Newest first: published ones, and the viewer's own drafts. */
  resources: StudyResource[];
  /** Printed page numbers of the pages cited anywhere in the group, "docId:page" → label (db/022). */
  pageLabels: Record<string, string>;
}

export function isCustodian(g: Pick<StudyGroup, 'custodianId'>, viewerId: string): boolean {
  return g.custodianId === viewerId;
}

export const PROGRESS_LABEL: Record<StudyProgressStatus, string> = {
  'not started': 'Not started',
  practising: 'Practising',
  done: 'Done',
};

export const lessonHref = (groupId: number, lessonId: number) => `/learning/${groupId}/lessons/${lessonId}`;
export const tabHref = (groupId: number, tab: GroupTab, anchor?: string) =>
  `/learning/${groupId}${tab === 'syllabus' ? '' : `?tab=${tab}`}${anchor ? `#${anchor}` : ''}`;

/** "45 min", "1 h 30 min". */
export function formatMinutes(m: number | null): string {
  if (m === null) return '';
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

// ── History (the connector's get_study_history; the Progress tab later) ─────

export interface StudyHistory {
  weeks: number;
  since: string;
  sessions: number;
  minutes: number;
  /** Per member: sessions and minutes in the period, and per week (oldest first). */
  members: { name: string; sessions: number; minutes: number; perWeek: number[] }[];
  /** Per accepted topic, in syllabus order: sessions and minutes (a session's minutes split evenly over its topics), last touched. */
  topics: { id: number; title: string; sessions: number; minutes: number; lastTouched: string | null }[];
  /** Accepted topics no session in the period touched. */
  neglected: string[];
  /** Sessions in the period that named no topic. */
  untagged: number;
}

/** History over the last `weeks` weeks, from the sessions the viewer can see; optionally one member's. */
export function studyHistory(g: StudyGroup, weeks: number, now: Date, memberId?: string): StudyHistory {
  const WEEK = 7 * 24 * 3600 * 1000;
  const since = new Date(now.getTime() - weeks * WEEK);
  const sessions = g.sessions.filter(
    (s) => s.published && new Date(s.startedAt) >= since && (!memberId || s.authorId === memberId),
  );
  const accepted = g.topics.filter((t) => t.review === 'accepted');
  const topicStats = new Map(accepted.map((t) => [t.id, { sessions: 0, minutes: 0, last: null as string | null }]));
  let untagged = 0;
  for (const s of sessions) {
    const ids = s.topicIds.filter((id) => topicStats.has(id));
    if (!ids.length) untagged++;
    for (const id of ids) {
      const st = topicStats.get(id)!;
      st.sessions++;
      st.minutes += (s.minutes ?? 0) / ids.length;
      if (!st.last || s.startedAt > st.last) st.last = s.startedAt;
    }
  }
  const byMember = new Map<string, { name: string; sessions: number; minutes: number; perWeek: number[] }>();
  for (const s of sessions) {
    const m = byMember.get(s.authorId) ?? { name: s.authorName, sessions: 0, minutes: 0, perWeek: Array(weeks).fill(0) };
    m.sessions++;
    m.minutes += s.minutes ?? 0;
    const w = Math.min(weeks - 1, Math.floor((new Date(s.startedAt).getTime() - since.getTime()) / WEEK));
    m.perWeek[Math.max(0, w)]++;
    byMember.set(s.authorId, m);
  }
  const topics = accepted.map((t) => {
    const st = topicStats.get(t.id)!;
    return { id: t.id, title: t.title, sessions: st.sessions, minutes: Math.round(st.minutes), lastTouched: st.last };
  });
  return {
    weeks,
    since: since.toISOString(),
    sessions: sessions.length,
    minutes: sessions.reduce((n, s) => n + (s.minutes ?? 0), 0),
    members: Array.from(byMember.values()),
    topics,
    neglected: topics.filter((t) => t.sessions === 0).map((t) => t.title),
    untagged,
  };
}

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

/** A document the group's lessons (accepted or waiting) cite, or that is shared with the group. */
export interface StudyDocument {
  id: number;
  /** Null when the viewer cannot read it. */
  title: string | null;
  sharedWithGroup: boolean;
  /** The viewer owns it, so may share it with the group or stop sharing it. */
  mine: boolean;
  /** Accepted lessons citing it. */
  citedBy: number;
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

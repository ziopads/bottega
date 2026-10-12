import {
  EXERCISE_DONE_MAX,
  EXERCISE_TASK_MAX,
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  LESSON_BODY_MAX,
  LESSON_TITLE_MAX,
  PROGRESS_NOTE_MAX,
  STUDY_PROGRESS,
  TOPIC_SUMMARY_MAX,
  TOPIC_TITLE_MAX,
  type StudyProgressStatus,
} from '@/lib/studyTypes';
import { text, type Parsed } from '@/lib/workflowInput';

// Input rules for the Learning section, shared by the routes and the
// connector. Each returns the clean value or a message a person (or Claude)
// can act on.

export const parseGroupName = (raw: unknown) => text(raw, 'The name', GROUP_NAME_MAX);
export const parseGroupDescription = (raw: unknown) => text(raw, 'The description', GROUP_DESCRIPTION_MAX, false);
export const parseTopicTitle = (raw: unknown) => text(raw, 'The title', TOPIC_TITLE_MAX);
export const parseTopicSummary = (raw: unknown) => text(raw, 'The summary', TOPIC_SUMMARY_MAX, false);
export const parseLessonTitle = (raw: unknown) => text(raw, 'The title', LESSON_TITLE_MAX);
export const parseTask = (raw: unknown) => text(raw, 'The task', EXERCISE_TASK_MAX);
export const parseExerciseDone = (raw: unknown) => text(raw, 'How it will be known to be done', EXERCISE_DONE_MAX);
export const parseProgressNote = (raw: unknown) => text(raw, 'The note', PROGRESS_NOTE_MAX, false);

/** A lesson body keeps its line breaks; only the ends are trimmed. */
export function parseLessonBody(raw: unknown): Parsed<string> {
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'The lesson needs a body.' };
  const value = raw.replace(/\r\n?/g, '\n').trim();
  if (value.length > LESSON_BODY_MAX) return { error: `Keep a lesson under ${LESSON_BODY_MAX} characters; split it into two.` };
  return { value };
}

export function parseProgressStatus(raw: unknown): Parsed<StudyProgressStatus> {
  return (STUDY_PROGRESS as readonly string[]).includes(raw as string)
    ? { value: raw as StudyProgressStatus }
    : { error: `The progress is one of: ${STUDY_PROGRESS.join(', ')}.` };
}

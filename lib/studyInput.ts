import {
  EXERCISE_DONE_MAX,
  EXERCISE_TASK_MAX,
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  LESSON_BODY_MAX,
  LESSON_TITLE_MAX,
  NOTE_BODY_MAX,
  PROGRESS_NOTE_MAX,
  SESSION_KINDS,
  SESSION_SUMMARY_MAX,
  STUDY_PROGRESS,
  type SessionKind,
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

/** Multi-line text that keeps its line breaks. */
function longText(raw: unknown, label: string, max: number, required: boolean): Parsed<string> {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) {
    return required ? { error: `${label} is required.` } : { value: '' };
  }
  if (typeof raw !== 'string') return { error: `${label} must be text.` };
  const value = raw.replace(/\r\n?/g, '\n').trim();
  if (value.length > max) return { error: `Keep ${label.toLowerCase()} under ${max} characters.` };
  return { value };
}

export const parseSessionSummary = (raw: unknown) => longText(raw, 'The summary', SESSION_SUMMARY_MAX, false);
export const parseNoteBody = (raw: unknown) => longText(raw, 'The note', NOTE_BODY_MAX, true);

export function parseSessionKind(raw: unknown): Parsed<SessionKind> {
  if (raw === undefined || raw === null || raw === '') return { value: 'at the instrument' };
  return (SESSION_KINDS as readonly string[]).includes(raw as string)
    ? { value: raw as SessionKind }
    : { error: `The kind of session is one of: ${SESSION_KINDS.join(', ')}.` };
}

export function parseMinutes(raw: unknown): Parsed<number | null> {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 1440 ? { value: n } : { error: 'Minutes are a whole number from 1 to 1440.' };
}

/** A date and time; null for now. Not in the future by more than a day (a slip of the date). */
export function parseStartedAt(raw: unknown): Parsed<string | null> {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (typeof raw !== 'string') return { error: 'Give the time as a date and time.' };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { error: `"${raw}" is not a date and time.` };
  if (d.getTime() > Date.now() + 24 * 3600 * 1000) return { error: 'That time is in the future.' };
  return { value: d.toISOString() };
}

export function parseIdList(raw: unknown): Parsed<number[]> {
  if (raw === undefined || raw === null) return { value: [] };
  if (!Array.isArray(raw)) return { error: 'Give a list of ids.' };
  const ids = raw.map(Number);
  return ids.every((n) => Number.isInteger(n) && n > 0) ? { value: ids } : { error: 'Invalid id in the list.' };
}

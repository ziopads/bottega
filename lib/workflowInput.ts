import { CARD_KINDS, CARD_STATUSES, CARD_TEXT_MAX, CRITERION_MAX, ELEMENT_NAME_MAX, type CardKind, type CardStatus } from '@/lib/workflowTypes';

// Input rules for the workflow, shared by the routes and the connector. Each
// returns the clean value or a message a person (or Claude) can act on.

export type Parsed<T> = { value: T } | { error: string };

export function text(raw: unknown, label: string, max: number, required = true): Parsed<string> {
  if (raw === undefined || raw === null) return required ? { error: `${label} is required.` } : { value: '' };
  if (typeof raw !== 'string') return { error: `${label} must be text.` };
  const value = raw.trim();
  if (required && !value) return { error: `${label} is required.` };
  if (value.length > max) return { error: `Keep ${label.toLowerCase()} under ${max} characters.` };
  return { value };
}

export const parseCriterion = (raw: unknown) => text(raw, 'The criterion', CRITERION_MAX);
export const parseElementName = (raw: unknown) => text(raw, 'The name', ELEMENT_NAME_MAX);
export const parseWhat = (raw: unknown) => text(raw, 'What needs to happen', CARD_TEXT_MAX);
export const parseDoneWhen = (raw: unknown) => text(raw, 'How it will be known to be done', CARD_TEXT_MAX);
export const parseReason = (raw: unknown, required: boolean) => text(raw, 'The reason', 500, required);

export function parseKind(raw: unknown): Parsed<CardKind | null> {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  return (CARD_KINDS as readonly string[]).includes(raw as string)
    ? { value: raw as CardKind }
    : { error: `The kind is one of: ${CARD_KINDS.join(', ')}.` };
}

export function parseStatus(raw: unknown): Parsed<CardStatus> {
  return (CARD_STATUSES as readonly string[]).includes(raw as string) && raw !== 'proposed'
    ? { value: raw as CardStatus }
    : { error: 'The status is accepted, in progress, done or rejected.' };
}

export function parseOptionalId(raw: unknown): Parsed<number | null> {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? { value: n } : { error: 'Invalid id.' };
}

export function parseStage(raw: unknown): Parsed<string> {
  return typeof raw === 'string' && /^[a-z]+$/.test(raw) ? { value: raw } : { error: 'Name a stage.' };
}

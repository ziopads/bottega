import {
  CARD_KINDS,
  CARD_STATUSES,
  CARD_TEXT_MAX,
  CRITERION_MAX,
  ELEMENT_NAME_MAX,
  type CardKind,
  type CardStatus,
  type WorkflowElement,
  type WorkflowStage,
} from '@/lib/workflowTypes';

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

// ── Loose lines at the end of a session (W-20) ───────────────────────────────

/** What a card gets when its line says nothing after " -- ". */
export const DONE_WHEN_UNWRITTEN = 'Not written yet';

const squash = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * One loose line as a card: "Snare too loud in drop 1 #tactus #mixdown -- the
 * snare sits under the hats". A #tag naming an element (a part before its
 * zone; a unique beginning of a name will do) sets the element; one naming a
 * stage parks the card there. Tags at the end of the line are taken out of
 * the text; a tag inside a sentence leaves its word ("Fix the #bass line"
 * reads "Fix the bass line"). Other tags stay as they are. Text after " -- "
 * is how it will be known to be done. Null for a line with nothing to do.
 */
export function parseSessionLine(
  raw: string,
  elements: WorkflowElement[],
  stages: WorkflowStage[],
): { what: string; doneWhen: string; elementId: number | null; stage: string | null } | null {
  const line = raw.replace(/^\s*[-*•]\s*/, '').trim();
  if (!line) return null;
  const [whatPart, ...rest] = line.split(' -- ');
  let elementId: number | null = null;
  let stage: string | null = null;
  const parts = elements.slice().sort((a, b) => Number(a.parentId === null) - Number(b.parentId === null));
  const MARK = '\u0001';
  const marked = whatPart.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (whole, space: string, tag: string) => {
    const t = squash(tag);
    const st = stages.find((s) => s.key === t || squash(s.label) === t);
    if (st && stage === null) {
      stage = st.key;
      return `${space}${MARK}${tag}`;
    }
    const exact = parts.find((e) => squash(e.name) === t);
    const begins = parts.filter((e) => squash(e.name).startsWith(t));
    const el = exact ?? (begins.length === 1 ? begins[0] : undefined);
    if (el && elementId === null) {
      elementId = el.id;
      return `${space}${MARK}${tag}`;
    }
    return whole;
  });
  const what = marked
    .replace(new RegExp(`(\\s*${MARK}\\S+)+\\s*$`, 'u'), '')
    .replaceAll(MARK, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, CARD_TEXT_MAX);
  if (!what) return null;
  const doneWhen = rest.join(' -- ').trim().slice(0, CARD_TEXT_MAX) || DONE_WHEN_UNWRITTEN;
  return { what, doneWhen, elementId, stage };
}

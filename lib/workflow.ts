import type { Scoped, Statement } from '@/lib/db';
import { ELEMENT_TEMPLATES } from '@/lib/elementTemplate';
import { accountNames, nameOf } from '@/lib/names';
import { mixLabel } from '@/lib/studioTypes';
import type {
  CardKind,
  CardStatus,
  ExitCriterion,
  StageMove,
  Workflow,
  WorkflowCard,
  WorkflowElement,
  WorkflowStage,
} from '@/lib/workflowTypes';

// A project's workflow (REQUIREMENTS W-1 to W-10, db/011): reads for the
// Workflow tab and the connector, and the writes behind the tab's controls.
// Every statement runs as the person; db/011's policies and functions decide
// who may do what, and its error messages are written to be shown.

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

/** A refusal from db/011 a person can read: its own messages, not Postgres internals. */
export class WorkflowError extends Error {}

function pgMessage(err: unknown): string {
  return (err as { message?: string })?.message ?? '';
}

// The messages db/011 raises on purpose, passed on as they are.
const READABLE =
  /needs (edit|a reason)|not met|one at a time|already in|not a stage|not been started|not a settled|has no stages|no stages yet|belongs to the same project|stays with its|cannot sit under/;

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = pgMessage(err);
    if (READABLE.test(msg)) throw new WorkflowError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
    if (/row-level security|permission denied/.test(msg)) throw new WorkflowError('Your access to this session does not allow that.');
    if (/violates check constraint/.test(msg)) throw new WorkflowError('That is missing something it needs.');
    throw err;
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

const CARD_SELECT = `
  select c.id, c.element_id, c.stage, c.kind, c.what, c.done_when, c.status, c.origin, c.source_note_id,
         c.audio_id, a.version as audio_version, a.variant as audio_variant, c.position_s, c.settled, c.settled_reason, c.settled_at,
         c.reopen_count, c.created_by, c.created_at, c.updated_at
    from cards c left join audio a on a.id = c.audio_id`;

function toCard(r: Row, who: Map<string, string>): WorkflowCard {
  return {
    id: num(r.id),
    elementId: numOrNull(r.element_id),
    stage: String(r.stage),
    kind: r.kind === null ? null : (String(r.kind) as CardKind),
    what: String(r.what),
    doneWhen: String(r.done_when),
    status: String(r.status) as CardStatus,
    origin: r.origin === 'assistant' ? 'assistant' : 'human',
    sourceNoteId: numOrNull(r.source_note_id),
    audioId: numOrNull(r.audio_id),
    audioVersion: numOrNull(r.audio_version),
    audioLabel: r.audio_version === null || r.audio_version === undefined ? null : mixLabel(String(r.audio_variant ?? ''), num(r.audio_version)),
    positionS: numOrNull(r.position_s),
    settled: r.settled === true,
    settledReason: String(r.settled_reason ?? ''),
    settledAt: isoOrNull(r.settled_at),
    reopenCount: num(r.reopen_count),
    createdById: String(r.created_by),
    createdByName: nameOf(who, String(r.created_by)),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toCriterion(r: Row, who: Map<string, string>): ExitCriterion {
  return {
    id: num(r.id),
    stage: String(r.stage),
    body: String(r.body),
    position: num(r.position),
    metAt: isoOrNull(r.met_at),
    metByName: r.met_by === null ? null : nameOf(who, String(r.met_by)),
    origin: r.origin === 'assistant' ? 'assistant' : 'human',
    reviewed: r.reviewed === true,
    rejected: r.rejected_at !== null,
  };
}

export async function getWorkflow(db: Scoped, projectId: number): Promise<Workflow> {
  const [stageRows, current, moveRows, criteriaRows, elementRows, cardRows] = await db.tx([
    {
      text: `select s.key, s.label, s.position from workflow_stages s join projects p on p.kind = s.kind
              where p.id = $1 order by s.position`,
      params: [projectId],
    },
    { text: 'select stage, entered_at from project_workflow where project_id = $1', params: [projectId] },
    {
      text: `select id, from_stage, to_stage, reason, moved_by, moved_at from stage_moves
              where project_id = $1 order by moved_at desc, id desc`,
      params: [projectId],
    },
    {
      text: `select id, stage, body, position, met_at, met_by, origin, reviewed, rejected_at from exit_criteria
              where project_id = $1 order by stage, position, id`,
      params: [projectId],
    },
    { text: 'select id, parent_id, name, position from elements where project_id = $1 order by position, id', params: [projectId] },
    { text: `${CARD_SELECT} where c.project_id = $1 order by c.created_at, c.id`, params: [projectId] },
  ]);
  const who = await accountNames(db, [
    ...moveRows.map((r) => String(r.moved_by)),
    ...criteriaRows.map((r) => (r.met_by === null ? null : String(r.met_by))),
    ...cardRows.map((r) => String(r.created_by)),
  ]);
  const stages: WorkflowStage[] = stageRows.map((r) => ({ key: String(r.key), label: String(r.label), position: num(r.position) }));
  const moves: StageMove[] = moveRows.map((r) => ({
    id: num(r.id),
    fromStage: r.from_stage === null ? null : String(r.from_stage),
    toStage: String(r.to_stage),
    reason: String(r.reason),
    movedByName: nameOf(who, String(r.moved_by)),
    movedAt: iso(r.moved_at),
  }));
  const elements: WorkflowElement[] = elementRows.map((r) => ({
    id: num(r.id),
    parentId: numOrNull(r.parent_id),
    name: String(r.name),
    position: num(r.position),
  }));
  return {
    stages,
    stage: current[0] ? String(current[0].stage) : null,
    enteredAt: current[0] ? iso(current[0].entered_at) : null,
    moves,
    criteria: criteriaRows.map((r) => toCriterion(r, who)),
    elements,
    cards: cardRows.map((r) => toCard(r, who)),
  };
}

// ── Stages ───────────────────────────────────────────────────────────────────

/**
 * Starts the workflow at the first stage and, the first time, copies the
 * element template for the project's kind. One transaction: the elements
 * exist exactly when the workflow does.
 */
export async function startWorkflow(db: Scoped, projectId: number): Promise<void> {
  await run(async () => {
    const kindRows = await db.q(
      `select p.kind, (select count(*) from elements e where e.project_id = p.id) as elements
         from projects p where p.id = $1`,
      [projectId],
    );
    const kind = String(kindRows[0]?.kind ?? '');
    const hasElements = num(kindRows[0]?.elements ?? 0) > 0;
    const statements: Statement[] = [{ text: 'select workflow_start($1)', params: [projectId] }];
    if (!hasElements) {
      // Parents first, then children found by name under the parent just
      // inserted: the transaction is non-interactive, so ids cannot pass
      // from one statement to the next.
      (ELEMENT_TEMPLATES[kind] ?? []).forEach((top, i) => {
        statements.push({
          text: 'insert into elements (project_id, name, position) values ($1, $2, $3)',
          params: [projectId, top.name, i + 1],
        });
        (top.children ?? []).forEach((child, j) => {
          statements.push({
            text: `insert into elements (project_id, parent_id, name, position)
                   select $1, id, $3, $4 from elements where project_id = $1 and parent_id is null and name = $2
                   order by elements.id desc limit 1`,
            params: [projectId, top.name, child, j + 1],
          });
        });
      });
    }
    await db.tx(statements);
  });
}

export async function moveStage(db: Scoped, projectId: number, to: string, reason: string): Promise<void> {
  await run(() => db.q('select workflow_move($1, $2, $3)', [projectId, to, reason]));
}

// ── Exit criteria ────────────────────────────────────────────────────────────

export async function addCriterion(
  db: Scoped,
  projectId: number,
  input: { stage: string; body: string; origin?: 'human' | 'assistant' },
): Promise<number> {
  return run(async () => {
    const assistant = input.origin === 'assistant';
    const rows = await db.q(
      `insert into exit_criteria (project_id, stage, body, position, origin, reviewed)
       values ($1, $2, $3, (select coalesce(max(position), 0) + 1 from exit_criteria where project_id = $1 and stage = $2), $4, $5)
       returning id`,
      [projectId, input.stage, input.body, assistant ? 'assistant' : 'human', !assistant],
    );
    return num(rows[0].id);
  });
}

/**
 * Several criteria for one stage in one transaction, after the existing
 * ones; for Claude's proposals (M-3), which arrive unreviewed.
 */
export async function addCriteria(
  db: Scoped,
  projectId: number,
  stage: string,
  bodies: string[],
  origin: 'human' | 'assistant',
): Promise<number[]> {
  return run(async () => {
    const assistant = origin === 'assistant';
    const results = await db.tx(
      bodies.map((body) => ({
        text: `insert into exit_criteria (project_id, stage, body, position, origin, reviewed)
               values ($1, $2, $3, (select coalesce(max(position), 0) + 1 from exit_criteria where project_id = $1 and stage = $2), $4, $5)
               returning id`,
        params: [projectId, stage, body, assistant ? 'assistant' : 'human', !assistant],
      })),
    );
    return results.map((rows) => num(rows[0].id));
  });
}

export type CriterionPatch = { body?: string; met?: boolean; accept?: boolean; reject?: boolean };

export async function updateCriterion(db: Scoped, id: number, patch: CriterionPatch): Promise<boolean> {
  return run(async () => {
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (patch.body !== undefined) {
      params.push(patch.body);
      sets.push(`body = $${params.length}`);
    }
    if (patch.met !== undefined) sets.push(patch.met ? 'met_at = coalesce(met_at, now())' : 'met_at = null');
    if (patch.accept) sets.push('reviewed = true', 'rejected_at = null');
    if (patch.reject) sets.push('reviewed = true', 'rejected_at = now()');
    if (!sets.length) return true;
    const rows = await db.q(`update exit_criteria set ${sets.join(', ')} where id = $1 returning id`, params);
    return rows.length > 0;
  });
}

export async function deleteCriterion(db: Scoped, id: number): Promise<boolean> {
  return run(async () => (await db.q('delete from exit_criteria where id = $1 returning id', [id])).length > 0);
}

// ── Elements ─────────────────────────────────────────────────────────────────

export async function addElement(db: Scoped, projectId: number, name: string, parentId: number | null): Promise<number> {
  return run(async () => {
    const rows = await db.q(
      `insert into elements (project_id, parent_id, name, position)
       values ($1, $2, $3, (select coalesce(max(position), 0) + 1 from elements
                             where project_id = $1 and parent_id is not distinct from $2))
       returning id`,
      [projectId, parentId, name],
    );
    return num(rows[0].id);
  });
}

export async function renameElement(db: Scoped, id: number, name: string): Promise<boolean> {
  return run(async () => (await db.q('update elements set name = $2 where id = $1 returning id', [id, name])).length > 0);
}

export async function deleteElement(db: Scoped, id: number): Promise<boolean> {
  return run(async () => (await db.q('delete from elements where id = $1 returning id', [id])).length > 0);
}

// ── Cards ────────────────────────────────────────────────────────────────────

export type CardInput = {
  elementId: number | null;
  stage: string;
  kind: CardKind | null;
  what: string;
  doneWhen: string;
  audioId?: number | null;
  positionS?: number | null;
  sourceNoteId?: number | null;
  origin?: 'human' | 'assistant';
};

export async function addCard(db: Scoped, projectId: number, input: CardInput): Promise<WorkflowCard> {
  return run(async () => {
    const assistant = input.origin === 'assistant';
    const rows = await db.q(
      `insert into cards (project_id, element_id, stage, kind, what, done_when, audio_id, position_s, source_note_id,
                          origin, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        projectId,
        input.elementId,
        input.stage,
        input.kind,
        input.what,
        input.doneWhen,
        input.audioId ?? null,
        input.positionS ?? null,
        input.sourceNoteId ?? null,
        assistant ? 'assistant' : 'human',
        assistant ? 'proposed' : 'accepted',
      ],
    );
    const card = await getCard(db, num(rows[0].id));
    if (!card) throw new Error('card vanished after insert');
    return card;
  });
}

export async function getCard(db: Scoped, id: number): Promise<(WorkflowCard & { projectId: number }) | null> {
  const rows = await db.q(`${CARD_SELECT.replace('select c.id,', 'select c.project_id, c.id,')} where c.id = $1`, [id]);
  if (!rows.length) return null;
  const who = await accountNames(db, [String(rows[0].created_by)]);
  return { ...toCard(rows[0], who), projectId: num(rows[0].project_id) };
}

export type CardPatch = Partial<{
  elementId: number | null;
  stage: string;
  kind: CardKind | null;
  what: string;
  doneWhen: string;
  status: CardStatus;
}>;

const CARD_COLUMNS: Record<keyof CardPatch, string> = {
  elementId: 'element_id',
  stage: 'stage',
  kind: 'kind',
  what: 'what',
  doneWhen: 'done_when',
  status: 'status',
};

export async function updateCard(db: Scoped, id: number, patch: CardPatch): Promise<WorkflowCard | null> {
  return run(async () => {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, column] of Object.entries(CARD_COLUMNS) as [keyof CardPatch, string][]) {
      if (patch[key] === undefined) continue;
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length) {
      const rows = await db.q(`update cards set ${sets.join(', ')} where id = $1 returning id`, params);
      if (!rows.length) return null;
    }
    return getCard(db, id);
  });
}

export async function deleteCard(db: Scoped, id: number): Promise<boolean> {
  return run(async () => (await db.q('delete from cards where id = $1 returning id', [id])).length > 0);
}

export async function settleCard(db: Scoped, id: number, reason: string): Promise<WorkflowCard | null> {
  return run(async () => {
    await db.q('select card_settle($1, $2)', [id, reason]);
    return getCard(db, id);
  });
}

export async function reopenCard(db: Scoped, id: number, reason: string): Promise<WorkflowCard | null> {
  return run(async () => {
    await db.q('select card_reopen($1, $2)', [id, reason]);
    return getCard(db, id);
  });
}

export async function settleNote(db: Scoped, noteId: number, reason: string, elementId: number | null): Promise<WorkflowCard | null> {
  return run(async () => {
    const rows = await db.q('select note_settle($1, $2, $3) as id', [noteId, reason, elementId]);
    return getCard(db, num(rows[0].id));
  });
}

/** The project an item belongs to, if the person can see it: for the routes' access checks. */
export async function projectOf(db: Scoped, table: 'cards' | 'elements' | 'exit_criteria' | 'notes', id: number): Promise<number | null> {
  const rows = await db.q(`select project_id from ${table} where id = $1`, [id]);
  return rows.length ? num(rows[0].project_id) : null;
}

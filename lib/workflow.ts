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
  SetReading,
  StructureChange,
  TemplateChange,
  WorkLogEntry,
  StartChoices,
  TemplateChoice,
  WorkflowLearning,
  WorkflowStage,
  WorkflowTemplateStatus,
} from '@/lib/workflowTypes';
import type { AlsSet } from '@/lib/als/types';
import { runChecks } from '@/lib/workflowChecks';
import { parseSessionLine } from '@/lib/workflowInput';

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
  /no structure template|needs (edit|contribute|a reason|what was done)|not met|one at a time|already in|not a stage|not been started|not a settled|has no stages|no stages yet|belongs to the same project|stays with its|cannot sit under|template no longer exists|not one you can (use|move|copy)|no such stage|needs edit access to the (project's template|artist)|not in this project/;

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
    hint: String(r.hint ?? ''),
    checkKey: r.check_key === null || r.check_key === undefined ? null : String(r.check_key),
    templateUid: r.template_uid === null || r.template_uid === undefined ? null : String(r.template_uid),
    position: num(r.position),
    metAt: isoOrNull(r.met_at),
    metByName: r.met_by === null ? null : nameOf(who, String(r.met_by)),
    origin: r.origin === 'assistant' ? 'assistant' : 'human',
    reviewed: r.reviewed === true,
    rejected: r.rejected_at !== null,
  };
}

export async function getWorkflow(db: Scoped, projectId: number): Promise<Workflow> {
  const [stageRows, current, templateRows, moveRows, criteriaRows, elementRows, cardRows, logRows] = await db.tx([
    { text: 'select key, label, position, standard from project_stage_list($1) order by position', params: [projectId] },
    {
      text: `select stage, entered_at, next_move, blocker, blocker_set_at, finished_at from project_workflow
              where project_id = $1`,
      params: [projectId],
    },
    { text: 'select template_id, name, version, seen_version from workflow_template_status($1)', params: [projectId] },
    {
      text: `select id, from_stage, to_stage, reason, moved_by, moved_at from stage_moves
              where project_id = $1 order by moved_at desc, id desc`,
      params: [projectId],
    },
    {
      text: `select id, stage, body, hint, check_key, template_uid, position, met_at, met_by, origin, reviewed, rejected_at from exit_criteria
              where project_id = $1 order by stage, position, id`,
      params: [projectId],
    },
    {
      text: `select id, parent_id, name, position, description, color, is_zone, prefixes, group_names, template_uid
               from elements where project_id = $1 order by position, id`,
      params: [projectId],
    },
    { text: `${CARD_SELECT} where c.project_id = $1 order by c.created_at, c.id`, params: [projectId] },
    {
      text: `select id, did, next_move, logged_by, logged_at from work_log
              where project_id = $1 order by logged_at desc, id desc limit 30`,
      params: [projectId],
    },
  ]);
  const [learningRows, editableRows] = await db.tx([
    {
      text: 'select id, stage, position, body, origin, reviewed, source, created_by_name, created_at, can_edit from project_learnings($1)',
      params: [projectId],
    },
    {
      text: `select template_can_edit(coalesce((select template_id from project_workflow where project_id = $1), project_template($1))) as ok`,
      params: [projectId],
    },
  ]);
  const who = await accountNames(db, [
    ...logRows.map((r) => String(r.logged_by)),
    ...moveRows.map((r) => String(r.moved_by)),
    ...criteriaRows.map((r) => (r.met_by === null ? null : String(r.met_by))),
    ...cardRows.map((r) => String(r.created_by)),
  ]);
  const stages: WorkflowStage[] = stageRows.map((r) => ({
    key: String(r.key),
    label: String(r.label),
    position: num(r.position),
    standard: String(r.standard ?? ''),
  }));
  const t = templateRows[0];
  const template: WorkflowTemplateStatus | null = t
    ? { id: num(t.template_id), name: String(t.name), version: num(t.version), seenVersion: num(t.seen_version) }
    : null;
  const criteria = criteriaRows.map((r) => toCriterion(r, who));
  const templateChanges = template && template.version > template.seenVersion ? await readTemplateChanges(db, projectId, criteria) : [];
  const workLog: WorkLogEntry[] = logRows.map((r) => ({
    id: num(r.id),
    did: String(r.did),
    nextMove: String(r.next_move),
    loggedByName: nameOf(who, String(r.logged_by)),
    loggedAt: iso(r.logged_at),
  }));
  const blockerSetAt = current[0] ? isoOrNull(current[0].blocker_set_at) : null;
  const sessionsSinceBlocker = blockerSetAt ? workLog.filter((e) => e.loggedAt > blockerSetAt).length : 0;
  const setReading = await readSet(db, projectId, criteria);
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
    description: String(r.description ?? ''),
    color: r.color === null || r.color === undefined ? null : String(r.color),
    isZone: r.is_zone === true,
    prefixes: Array.isArray(r.prefixes) ? r.prefixes.map(String) : [],
    groupNames: Array.isArray(r.group_names) ? r.group_names.map(String) : [],
    templateUid: r.template_uid === null || r.template_uid === undefined ? null : String(r.template_uid),
  }));
  const { structure, structureChanges } = await readStructureChanges(db, projectId, elements);
  return {
    stages,
    stage: current[0] ? String(current[0].stage) : null,
    enteredAt: current[0] ? iso(current[0].entered_at) : null,
    nextMove: current[0] ? String(current[0].next_move ?? '') : '',
    blocker: current[0] ? String(current[0].blocker ?? '') : '',
    blockerSetAt,
    finishedAt: current[0] ? isoOrNull(current[0].finished_at) : null,
    template,
    templateChanges,
    structure,
    structureChanges,
    workLog,
    sessionsSinceBlocker,
    setReading,
    moves,
    criteria,
    elements,
    cards: cardRows.map((r) => toCard(r, who)),
    learnings: learningRows.map(toLearning),
    learningsEditable: editableRows[0]?.ok === true,
    startChoices: current[0] ? null : await readStartChoices(db, projectId),
  };
}

function toLearning(r: Row): WorkflowLearning {
  return {
    id: num(r.id),
    stage: String(r.stage),
    position: num(r.position),
    body: String(r.body),
    origin: r.origin === 'assistant' ? 'assistant' : 'human',
    reviewed: r.reviewed === true,
    source: String(r.source ?? ''),
    createdByName: String(r.created_by_name ?? ''),
    createdAt: iso(r.created_at),
    canEdit: r.can_edit === true,
  };
}

/**
 * The templates a workflow can start with: every one the person can read
 * (their own, the platform's, and those of artists shared with them), the
 * project's own first (its artist's, else its owner's).
 */
async function readStartChoices(db: Scoped, projectId: number): Promise<StartChoices> {
  const [own, templates, structures] = await db.tx([
    {
      text: `select project_template($1) as template_id,
                    case when p.kind = 'music' then project_structure_template($1) end as structure_id, p.kind
               from projects p where p.id = $1`,
      params: [projectId],
    },
    {
      text: `select t.id, t.name, t.owner_id from workflow_templates t
              where t.kind = (select kind from projects where id = $1) order by t.owner_id is null, lower(t.name)`,
      params: [projectId],
    },
    {
      text: `select t.id, t.name, t.owner_id from structure_templates t
              where (select kind from projects where id = $1) = 'music' order by t.owner_id is null, lower(t.name)`,
      params: [projectId],
    },
  ]);
  const templateId = own[0]?.template_id == null ? null : num(own[0].template_id);
  const structureId = own[0]?.structure_id == null ? null : num(own[0].structure_id);
  const choices = (rows: Row[], ownId: number | null): TemplateChoice[] => {
    const list = rows.map((r) => ({
      id: num(r.id),
      name: String(r.name),
      note:
        num(r.id) === ownId
          ? "this project's own"
          : r.owner_id === null
            ? 'Bottega default'
            : String(r.owner_id) === db.person.userId
              ? 'yours'
              : 'shared through an artist',
    }));
    return [...list.filter((c) => c.id === ownId), ...list.filter((c) => c.id !== ownId)];
  };
  return { templates: choices(templates, templateId), structures: choices(structures, structureId), templateId, structureId };
}

// ── Stages ───────────────────────────────────────────────────────────────────

/**
 * Starts the workflow at the first stage and, the first time, copies the
 * element template for the project's kind. One transaction: the elements
 * exist exactly when the workflow does. workflow_start (db/024) copies the
 * owner's template: its stages and every stage's criteria.
 */
export async function startWorkflow(
  db: Scoped,
  projectId: number,
  choice: { templateId: number | null; structureId: number | null } = { templateId: null, structureId: null },
): Promise<void> {
  await run(async () => {
    const kindRows = await db.q(
      `select p.kind, (select count(*) from elements e where e.project_id = p.id) as elements
         from projects p where p.id = $1`,
      [projectId],
    );
    const kind = String(kindRows[0]?.kind ?? '');
    const hasElements = num(kindRows[0]?.elements ?? 0) > 0;
    // workflow_start_with (db/028): the template named, else the project's own.
    const statements: Statement[] = [
      { text: 'select workflow_start_with($1, $2, $3)', params: [projectId, choice.templateId, choice.structureId] },
    ];
    // Music takes its elements from the owner's track structure inside
    // workflow_start (db/025); other kinds from lib/elementTemplate.ts.
    if (!hasElements && kind !== 'music') {
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

// ── Likely done (W-18) ───────────────────────────────────────────────────────

/** Runs the checks the criteria name against the newest saved set of the main mix. */
async function readSet(db: Scoped, projectId: number, criteria: ExitCriterion[]): Promise<SetReading | null> {
  const keys = new Set(criteria.filter((c) => c.checkKey && c.reviewed && !c.rejected).map((c) => c.checkKey as string));
  if (!keys.size) return null;
  const [snap, refs] = await db.tx([
    {
      text: `select file_name, saved_at, data from als_snapshots where project_id = $1 and variant = ''
              order by saved_at desc, id desc limit 1`,
      params: [projectId],
    },
    { text: `select count(*) as n from audio where project_id = $1 and role = 'reference'`, params: [projectId] },
  ]);
  const s = snap[0];
  const set = s ? (s.data as AlsSet) : null;
  return {
    fileName: s ? String(s.file_name) : null,
    savedAt: s ? iso(s.saved_at) : null,
    results: runChecks(keys, { set, references: num(refs[0]?.n ?? 0) }),
  };
}

// ── Template changes (W-17, db/024) ──────────────────────────────────────────

/** What the project's template offers: criteria it lacks, and criteria whose text differs from its own. */
async function readTemplateChanges(db: Scoped, projectId: number, criteria: ExitCriterion[]): Promise<TemplateChange[]> {
  const rows = await db.q(
    `select stage, stage_label, uid, body, hint from workflow_template_criteria($1) where uid is not null`,
    [projectId],
  );
  const mine = new Map(criteria.filter((c) => c.templateUid).map((c) => [c.templateUid as string, c]));
  const changes: TemplateChange[] = [];
  for (const r of rows) {
    const uid = String(r.uid);
    const body = String(r.body);
    const hint = String(r.hint ?? '');
    const own = mine.get(uid);
    const base = { uid, stage: String(r.stage), stageLabel: String(r.stage_label), body, hint };
    if (!own) changes.push({ ...base, change: 'new', was: null });
    else if (own.body !== body || own.hint !== hint) changes.push({ ...base, change: 'changed', was: { body: own.body, hint: own.hint } });
  }
  return changes;
}

// ── Track structure changes (W-28, db/025) ───────────────────────────────────

const describe = (name: string, isZone: boolean, prefixes: string[], groupNames: string[]) =>
  [name, isZone ? [...prefixes, ...groupNames.map((g) => `group “${g}”`)].join(', ') || 'zone' : 'not a zone'].join(' · ');

/** What the project's track structure offers since the project took it. */
async function readStructureChanges(
  db: Scoped,
  projectId: number,
  elements: WorkflowElement[],
): Promise<{ structure: Workflow['structure']; structureChanges: StructureChange[] }> {
  const status = await db.q('select name, version, seen_version from structure_template_status($1)', [projectId]);
  if (!status.length) return { structure: null, structureChanges: [] };
  const structure = { name: String(status[0].name), version: num(status[0].version), seenVersion: num(status[0].seen_version) };
  if (structure.version <= structure.seenVersion) return { structure, structureChanges: [] };
  const rows = await db.q(
    'select uid, parent_uid, name, description, color, is_zone, prefixes, group_names from structure_template_elements($1)',
    [projectId],
  );
  const mine = new Map(elements.filter((e) => e.templateUid).map((e) => [e.templateUid as string, e]));
  const names = new Map(rows.map((r) => [String(r.uid), String(r.name)]));
  const changes: StructureChange[] = [];
  for (const r of rows) {
    const uid = String(r.uid);
    const parentUid = r.parent_uid === null ? null : String(r.parent_uid);
    const prefixes = Array.isArray(r.prefixes) ? r.prefixes.map(String) : [];
    const groupNames = Array.isArray(r.group_names) ? r.group_names.map(String) : [];
    const own = mine.get(uid);
    const now = parentUid ? String(r.name) : describe(String(r.name), r.is_zone === true, prefixes, groupNames);
    const parentName = parentUid ? (names.get(parentUid) ?? null) : null;
    if (!own) {
      // A new part can only come in under a parent the project has.
      if (parentUid && !mine.has(parentUid)) continue;
      changes.push({ uid, change: 'new', name: String(r.name), parentName, was: null, now });
      continue;
    }
    const differs = parentUid
      ? own.name !== r.name || own.description !== String(r.description ?? '')
      : own.name !== r.name ||
        own.description !== String(r.description ?? '') ||
        own.color !== (r.color ?? null) ||
        own.isZone !== (r.is_zone === true) ||
        JSON.stringify(own.prefixes) !== JSON.stringify(prefixes) ||
        JSON.stringify(own.groupNames) !== JSON.stringify(groupNames);
    if (differs) {
      const was = parentUid ? own.name : describe(own.name, own.isZone, own.prefixes, own.groupNames);
      changes.push({ uid, change: 'changed', name: String(r.name), parentName, was: was === now ? null : was, now });
    }
  }
  return { structure, structureChanges: changes };
}

/** Brings the chosen structure changes in and marks the version seen; an empty list dismisses. */
export async function applyStructureChanges(db: Scoped, projectId: number, uids: string[]): Promise<void> {
  await run(() => db.q('select structure_apply($1, $2::uuid[])', [projectId, uids]));
}

/** Brings the chosen template changes in and marks the template's version seen; an empty list dismisses. */
export async function applyTemplateChanges(db: Scoped, projectId: number, uids: string[]): Promise<void> {
  await run(() => db.q('select template_apply($1, $2::uuid[])', [projectId, uids]));
}

// ── The next move and ending a session (W-19, W-20, db/024) ──────────────────

/** Sets the next move, the blocker, or both; undefined leaves one alone. */
export async function setNext(db: Scoped, projectId: number, next: string | undefined, blocker: string | undefined): Promise<void> {
  await run(() => db.q('select workflow_set_next($1, $2, $3)', [projectId, next ?? null, blocker ?? null]));
}

/**
 * Ends a session: logs what was done, sets the next move, and turns each loose
 * line into a card in the current stage, or the stage a #tag names, on the
 * element a #tag names. One transaction.
 */
export async function endSession(
  db: Scoped,
  projectId: number,
  input: { did: string; next: string; lines: string[] },
  w: Workflow,
): Promise<void> {
  if (!w.stage) throw new WorkflowError('The workflow has not been started.');
  const current = w.stage;
  const pos = (key: string | null) => w.stages.find((s) => s.key === key)?.position ?? 0;
  const statements: Statement[] = [{ text: 'select work_log_add($1, $2, $3)', params: [projectId, input.did, input.next] }];
  for (const line of input.lines) {
    const c = parseSessionLine(line, w.elements, w.stages);
    if (!c) continue;
    statements.push({
      text: `insert into cards (project_id, element_id, stage, what, done_when, origin, status)
             values ($1, $2, $3, $4, $5, 'human', 'accepted')`,
      // A tag naming an earlier stage is ignored: open work goes in the current one or later.
      params: [projectId, c.elementId, pos(c.stage) > pos(current) ? c.stage : current, c.what, c.doneWhen],
    });
  }
  await run(() => db.tx(statements));
}

/**
 * The next move is done: log it, and make the first open card of the current
 * stage the next move (in progress before accepted, then oldest first).
 */
export async function pullNext(db: Scoped, projectId: number, w: Workflow): Promise<void> {
  if (!w.nextMove.trim()) throw new WorkflowError('There is no next move to mark done.');
  const open = w.cards
    .filter((c) => c.stage === w.stage && !c.settled && (c.status === 'in progress' || c.status === 'accepted'))
    .sort((a, b) => Number(b.status === 'in progress') - Number(a.status === 'in progress') || a.createdAt.localeCompare(b.createdAt));
  const next = open.find((c) => c.what.trim() !== w.nextMove.trim())?.what ?? '';
  await run(() => db.q('select work_log_add($1, $2, $3)', [projectId, `Done: ${w.nextMove}`, next]));
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
  hints: string[] = [],
): Promise<number[]> {
  return run(async () => {
    const assistant = origin === 'assistant';
    const results = await db.tx(
      bodies.map((body, i) => ({
        text: `insert into exit_criteria (project_id, stage, body, hint, position, origin, reviewed)
               values ($1, $2, $3, $4, (select coalesce(max(position), 0) + 1 from exit_criteria where project_id = $1 and stage = $2), $5, $6)
               returning id`,
        params: [projectId, stage, body, hints[i] ?? '', assistant ? 'assistant' : 'human', !assistant],
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

// ── Learnings (W-33, db/028) ─────────────────────────────────────────────────
//
// Learnings live on the template's stages; the project names the template.
// learning_add() checks the person can edit the template; editing, accepting
// and deleting go through template_learnings' policies, so they touch nothing
// the person cannot edit.

export async function addLearning(
  db: Scoped,
  projectId: number,
  stage: string,
  body: string,
  origin: 'human' | 'assistant' = 'human',
  source = '',
): Promise<number> {
  return run(async () => {
    const rows = await db.q('select learning_add($1, $2, $3, $4, $5) as id', [projectId, stage, body, source, origin]);
    return num(rows[0].id);
  });
}

/** The learning's id, if it belongs to the template this project uses. */
async function learningOf(db: Scoped, projectId: number, id: number): Promise<boolean> {
  const rows = await db.q('select 1 from project_learnings($1) where id = $2 and can_edit', [projectId, id]);
  return rows.length > 0;
}

export async function editLearning(db: Scoped, projectId: number, id: number, body: string): Promise<boolean> {
  if (!(await learningOf(db, projectId, id))) return false;
  await run(() => db.q('update template_learnings set body = $2 where id = $1', [id, body]));
  return true;
}

export async function acceptLearning(db: Scoped, projectId: number, id: number): Promise<boolean> {
  if (!(await learningOf(db, projectId, id))) return false;
  await run(() => db.q('update template_learnings set reviewed = true where id = $1', [id]));
  return true;
}

/** Deletes a learning, or rejects Claude's proposal. */
export async function deleteLearning(db: Scoped, projectId: number, id: number): Promise<boolean> {
  if (!(await learningOf(db, projectId, id))) return false;
  await run(() => db.q('delete from template_learnings where id = $1', [id]));
  return true;
}

// ── Moving items between notes, to-dos and learnings (W-34, db/028) ──────────

function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Where an item came from, kept on a learning made from it: "Khione · v4 at 3:30". */
async function itemSource(db: Scoped, table: 'notes' | 'cards', id: number): Promise<string> {
  const rows = await db.q(
    `select coalesce(nullif(p.title, ''), mp.canonical_id, 'untitled') as title, a.version, a.variant, x.position_s
       from ${table} x join projects p on p.id = x.project_id
       left join music_projects mp on mp.project_id = p.id
       left join audio a on a.id = x.audio_id
      where x.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return '';
  const mix = r.version === null || r.version === undefined ? '' : mixLabel(String(r.variant ?? ''), num(r.version));
  const at = mix && r.position_s !== null && r.position_s !== undefined ? ` at ${clock(num(r.position_s))}` : '';
  return [String(r.title), mix + at].filter(Boolean).join(' · ').slice(0, 300);
}

export async function noteToCard(
  db: Scoped,
  noteId: number,
  input: { elementId: number | null; doneWhen: string; kind: CardKind | null },
): Promise<number> {
  return run(async () => {
    const rows = await db.q('select note_to_card($1, $2, $3, $4) as id', [noteId, input.elementId, input.doneWhen, input.kind]);
    return num(rows[0].id);
  });
}

export async function cardToNote(db: Scoped, cardId: number): Promise<number> {
  return run(async () => {
    const rows = await db.q('select card_to_note($1) as id', [cardId]);
    return num(rows[0].id);
  });
}

/** A note or a to-do becomes a learning on the stage named (else the item's own); body null keeps its text. */
export async function itemToLearning(
  db: Scoped,
  table: 'notes' | 'cards',
  id: number,
  stage: string | null,
  body: string | null,
): Promise<number> {
  return run(async () => {
    const source = await itemSource(db, table, id);
    const fn = table === 'notes' ? 'note_to_learning' : 'card_to_learning';
    const rows = await db.q(`select ${fn}($1, $2, $3, $4) as id`, [id, stage, body, source]);
    return num(rows[0].id);
  });
}

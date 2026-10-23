// draft_criteria and draft_card: Claude's proposals (REQUIREMENTS M-3, W-3,
// W-6). Each is stored as written by the assistant and unreviewed, in the
// connected person's name, and waits in the review band on the session's
// Workflow tab until a person accepts or rejects it. Nothing here edits or
// deletes.
//
// The person's own access applies (db/011): proposing exit criteria needs
// edit access to the session, proposing a card needs contribute.

import type { Scoped } from '@/lib/db';
import { getProject } from '@/lib/studio';
import { addCard, addCriteria, getWorkflow, WorkflowError } from '@/lib/workflow';
import { parseCriterion, parseDoneWhen, parseKind, parseWhat } from '@/lib/workflowInput';
import type { Workflow } from '@/lib/workflowTypes';
import { ToolError } from '@/mcp/context';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

async function started(db: Scoped, sessionId: number): Promise<Workflow> {
  const project = await getProject(db, sessionId);
  if (!project) throw new ToolError(`No session ${sessionId} that you can see. list_projects gives the ids.`);
  const w = await getWorkflow(db, sessionId);
  if (!w.stage) {
    throw new ToolError('The workflow of this project has not been started. Ask the person to start it on the Workflow tab first.');
  }
  return w;
}

/** A stage by its label or key, any case; the current stage when omitted. */
function stageKey(w: Workflow, raw: string | undefined): string {
  if (!raw || !raw.trim()) return w.stage as string;
  const found = w.stages.find((s) => norm(s.key) === norm(raw) || norm(s.label) === norm(raw));
  if (!found) throw new ToolError(`No stage "${raw}". The stages are: ${w.stages.map((s) => s.label).join(', ')}.`);
  return found.key;
}

/** An element by its path as get_session gives it ("STRUCTURE › Drop"), or a unique name. */
function elementId(w: Workflow, raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const byId = new Map(w.elements.map((e) => [e.id, e]));
  const path = (id: number) => {
    const e = byId.get(id)!;
    const parent = e.parentId === null ? undefined : byId.get(e.parentId);
    return parent ? `${parent.name} › ${e.name}` : e.name;
  };
  const asked = norm(raw.replace(/\s*(›|>|\/)\s*/g, ' › '));
  const exact = w.elements.filter((e) => norm(path(e.id)) === asked);
  if (exact.length === 1) return exact[0].id;
  const named = w.elements.filter((e) => norm(e.name) === asked);
  if (named.length === 1) return named[0].id;
  const tops = w.elements.filter((e) => e.parentId === null).map((t) => t.name);
  throw new ToolError(
    named.length > 1
      ? `"${raw}" names more than one element; give its path, such as "${path(named[0].id)}".`
      : `No element "${raw}". The top-level elements are: ${tops.join(', ')}; get_session lists their parts.`,
  );
}

/** "1:35", "95" or 95 → seconds. */
function seconds(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return raw >= 0 ? raw : null;
  const m = raw.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) throw new ToolError(`"${raw}" is not a time; write it as m:ss, such as 1:35.`);
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

function readable<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof WorkflowError) throw new ToolError(err.message);
    throw err;
  });
}

type CriterionArg = string | { criterion: string; hint?: string };

export async function draftCriteriaTool(db: Scoped, args: { session_id: number; stage?: string; criteria: CriterionArg[] }) {
  const w = await started(db, args.session_id);
  const stage = stageKey(w, args.stage);
  if (!args.criteria.length) throw new ToolError('Give at least one criterion.');
  if (args.criteria.length > 12) throw new ToolError('Propose at most 12 criteria at a time.');

  const clean: string[] = [];
  const hintOf = new Map<string, string>();
  for (const item of args.criteria) {
    const raw = typeof item === 'string' ? item : item.criterion;
    const p = parseCriterion(raw);
    if ('error' in p) throw new ToolError(`${p.error} (“${String(raw).slice(0, 60)}”)`);
    const hint = typeof item === 'string' ? '' : (item.hint ?? '').replace(/\s+$/, '');
    if (hint.length > 2000) throw new ToolError(`Keep each hint under 2000 characters (“${p.value.slice(0, 60)}”).`);
    clean.push(p.value);
    if (hint) hintOf.set(norm(p.value), hint);
  }
  // Skip what the stage already has, accepted or waiting.
  const existing = new Set(w.criteria.filter((c) => c.stage === stage && !c.rejected).map((c) => norm(c.body)));
  const fresh = clean.filter((c, i) => !existing.has(norm(c)) && clean.findIndex((d) => norm(d) === norm(c)) === i);
  const skipped = clean.length - fresh.length;
  const hints = fresh.map((c) => hintOf.get(norm(c)) ?? '');
  const ids = fresh.length ? await readable(() => addCriteria(db, args.session_id, stage, fresh, 'assistant', hints)) : [];

  const label = w.stages.find((s) => s.key === stage)?.label ?? stage;
  return {
    proposed: ids.map((id, i) => ({ id, stage: label, criterion: fresh[i], hint: hints[i] || undefined })),
    skipped_as_already_there: skipped || undefined,
    next:
      'These wait in the review band on the project’s Workflow tab. They do not count toward the stage until the person accepts them; ' +
      'tell them so, and that they can reword one after accepting it.',
  };
}

export async function draftCardTool(
  db: Scoped,
  args: {
    session_id: number;
    what: string;
    done_when: string;
    element?: string;
    kind?: string;
    stage?: string;
    from_note?: number;
    mix?: number;
    variant?: string;
    at?: string | number;
  },
) {
  const w = await started(db, args.session_id);
  const stage = stageKey(w, args.stage);
  const element = elementId(w, args.element);
  const kind = parseKind(args.kind);
  if ('error' in kind) throw new ToolError(kind.error);
  const what = parseWhat(args.what);
  if ('error' in what) throw new ToolError(what.error);
  const doneWhen = parseDoneWhen(args.done_when);
  if ('error' in doneWhen) throw new ToolError(doneWhen.error);

  // The mix and moment: from the note it came from, else as given.
  let audioId: number | null = null;
  let positionS: number | null = null;
  if (args.from_note !== undefined) {
    const rows = await db.q('select audio_id, position_s from notes where id = $1 and project_id = $2', [args.from_note, args.session_id]);
    if (!rows.length) throw new ToolError(`No note ${args.from_note} on this project; get_session lists the latest notes with their ids.`);
    audioId = rows[0].audio_id === null ? null : Number(rows[0].audio_id);
    positionS = rows[0].position_s === null ? null : Number(rows[0].position_s);
  }
  if (args.mix !== undefined) {
    const variant = (args.variant ?? '').trim().toLowerCase() === 'main' ? '' : (args.variant ?? '').trim();
    const rows = await db.q(`select id from audio where project_id = $1 and role = 'mix' and version = $2 and lower(variant) = lower($3)`, [
      args.session_id,
      args.mix,
      variant,
    ]);
    if (!rows.length) throw new ToolError(`This project has no mix ${variant ? `${variant} ` : ''}v${args.mix}.`);
    audioId = Number(rows[0].id);
  }
  const at = seconds(args.at);
  if (at !== null) {
    if (audioId === null) throw new ToolError('A moment needs a mix: give mix (its version number) or from_note.');
    positionS = at;
  }

  const card = await readable(() =>
    addCard(db, args.session_id, {
      stage,
      elementId: element,
      kind: kind.value,
      what: what.value,
      doneWhen: doneWhen.value,
      audioId,
      positionS,
      sourceNoteId: args.from_note ?? null,
      origin: 'assistant',
    }),
  );
  const pos = w.stages.find((s) => s.key === w.stage)?.position ?? 0;
  const cardPos = w.stages.find((s) => s.key === stage)?.position ?? 0;
  return {
    proposed: {
      id: card.id,
      stage: w.stages.find((s) => s.key === stage)?.label ?? stage,
      element: args.element ?? null,
      kind: card.kind,
      what: card.what,
      done_when: card.doneWhen,
      about: card.audioLabel !== null ? { mix: card.audioLabel, at: card.positionS } : null,
      from_note: card.sourceNoteId,
      parked_for_later_stage: cardPos > pos || undefined,
    },
    next: 'This waits in the review band on the project’s Workflow tab until the person accepts or rejects it.',
  };
}

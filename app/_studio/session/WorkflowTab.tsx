'use client';

import { useMemo, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { formatMoment, formatWhen } from '@/app/_studio/Notes';
import { DetailGrid, Section } from '@/app/_ui/layout';
import {
  CARD_KINDS,
  PERSON_STATUSES,
  stagePosition,
  type CardKind,
  type CardStatus,
  type ExitCriterion,
  type Workflow,
  type WorkflowCard,
  type WorkflowElement,
} from '@/lib/workflowTypes';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';

// The Workflow tab (REQUIREMENTS W-1 to W-10, db/011), layout C:
//
//   stage strip     the stages in order, the current one marked
//   review band     Claude's proposals, waiting for a person
//   left column     the current stage: exit criteria to tick, advance, move back
//   main column     open cards by element; cards parked for later stages;
//                   settled decisions; the element tree
//
// What the controls offer follows the viewer's level; the routes and db/011
// enforce the same rules. Every change answers with the whole workflow.

const FIELD = 'rounded border border-line bg-card px-1.5 py-0.5 outline-none focus:border-rust';

type Props = {
  projectId: number;
  workflow: Workflow;
  setWorkflow: (w: Workflow) => void;
  viewerId: string;
  canContribute: boolean;
  canEdit: boolean;
  isOwner: boolean;
};

export default function WorkflowTab({ projectId, workflow: w, setWorkflow, viewerId, canContribute, canEdit, isOwner }: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setError('');
    setBusy(true);
    const r = await api<{ workflow: Workflow }>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'That did not go through.');
      return false;
    }
    setWorkflow(r.data.workflow);
    return true;
  }

  if (!w.stages.length) {
    return (
      <DetailGrid
        main={
          <Section label="Workflow">
            <p className="t-body text-muted">This kind of project has no stages yet.</p>
          </Section>
        }
      />
    );
  }

  if (!w.stage) {
    return (
      <DetailGrid
        main={
          <Section label="Workflow">
            <div className="t-body max-w-prose space-y-3">
              <p>
                The workflow keeps track of where this session stands: one stage at a time ({w.stages.map((s) => s.label).join(', ')}),
                each finished when its exit criteria are met, with the open work on each part of the track as cards.
              </p>
              {canEdit ? (
                <button onClick={() => call(`/api/projects/${projectId}/workflow`, 'POST', { op: 'start' })} disabled={busy} className={BUTTON}>
                  Start at {w.stages[0].label}
                </button>
              ) : (
                <p className="text-muted">Not started yet. Someone with edit access starts it.</p>
              )}
            </div>
          </Section>
        }
      />
    );
  }

  return (
    <StartedWorkflow
      projectId={projectId}
      w={w}
      viewerId={viewerId}
      canContribute={canContribute}
      canEdit={canEdit}
      isOwner={isOwner}
      busy={busy}
      error={error}
      call={call}
    />
  );
}

function StartedWorkflow({
  projectId,
  w,
  viewerId,
  canContribute,
  canEdit,
  isOwner,
  busy,
  error,
  call,
}: {
  projectId: number;
  w: Workflow;
  viewerId: string;
  canContribute: boolean;
  canEdit: boolean;
  isOwner: boolean;
  busy: boolean;
  error: string;
  call: (url: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const current = w.stage as string;
  const pos = stagePosition(w, current);
  const stageLabel = (key: string) => w.stages.find((s) => s.key === key)?.label ?? key;
  const next = w.stages.find((s) => s.position === pos + 1) ?? null;

  const elementName = useMemo(() => {
    const byId = new Map(w.elements.map((e) => [e.id, e]));
    return (id: number | null): { top: string; part: string | null } => {
      const e = id === null ? undefined : byId.get(id);
      if (!e) return { top: 'Unassigned', part: null };
      const parent = e.parentId === null ? undefined : byId.get(e.parentId);
      return parent ? { top: parent.name, part: e.name } : { top: e.name, part: null };
    };
  }, [w.elements]);

  const tops = w.elements.filter((e) => e.parentId === null).sort((a, b) => a.position - b.position);
  const live = w.cards.filter((c) => !c.settled && c.status !== 'proposed' && c.status !== 'rejected');
  const openHere = live.filter((c) => c.stage === current && c.status !== 'done');
  const doneHere = live.filter((c) => c.stage === current && c.status === 'done');
  const parked = live.filter((c) => stagePosition(w, c.stage) > pos);
  const settled = w.cards.filter((c) => c.settled);
  const proposedCards = w.cards.filter((c) => c.status === 'proposed');
  const proposedCriteria = w.criteria.filter((c) => !c.reviewed);
  const criteria = w.criteria.filter((c) => c.stage === current && c.reviewed && !c.rejected);
  const unmet = criteria.filter((c) => !c.metAt).length;

  const canChange = (c: WorkflowCard) => canEdit || (canContribute && c.createdById === viewerId);
  const cardProps = { elementName, stageLabel, canChange, canEdit, isOwner, busy, call };

  // Parked cards stay folded away (W-8); a later stage's chip opens just its own.
  const [parkedOpen, setParkedOpen] = useState(false);
  const [parkedFocus, setParkedFocus] = useState<string | null>(null);
  function openParked(stage: string | null) {
    setParkedFocus(stage);
    setParkedOpen(true);
    if (typeof document !== 'undefined') {
      requestAnimationFrame(() => document.getElementById('parked-cards')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  }

  // ── Stage strip ─────────────────────────────────────────────────────────────
  const strip = (
    <ol className="t-body mb-6 flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Stages">
      {w.stages.map((s, i) => {
        const state = s.position < pos ? 'past' : s.position === pos ? 'current' : 'later';
        return (
          <li key={s.key} className="flex items-center gap-1">
            {i > 0 && <span className="px-1 text-muted" aria-hidden>→</span>}
            {state === 'later' && parked.some((c) => c.stage === s.key) ? (
              <button
                type="button"
                onClick={() => (parkedOpen && parkedFocus === s.key ? setParkedOpen(false) : openParked(s.key))}
                title={`Cards parked for ${s.label}`}
                className={`rounded border px-2.5 py-0.5 hover:text-ink ${
                  parkedOpen && parkedFocus === s.key ? 'border-ink text-ink' : 'border-line text-muted'
                }`}
              >
                {s.label}
                <span className="t-num ml-1.5 text-[11px]">{parked.filter((c) => c.stage === s.key).length}</span>
              </button>
            ) : (
              <span
                aria-current={state === 'current' ? 'step' : undefined}
                className={`rounded border px-2.5 py-0.5 ${
                  state === 'current' ? 'border-ink font-medium text-ink' : state === 'past' ? 'border-line text-ink' : 'border-line text-muted'
                }`}
              >
                {state === 'past' && <span className="mr-1 text-muted">✓</span>}
                {s.label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );

  // ── Review band ─────────────────────────────────────────────────────────────
  const review =
    proposedCards.length + proposedCriteria.length > 0 ? (
      <div className="t-body mb-6 rounded border border-line bg-card px-3 py-2">
        <p className="t-label mb-1">Proposed by Claude · {proposedCards.length + proposedCriteria.length} waiting</p>
        <ul className="divide-y divide-line">
          {proposedCriteria.map((c) => (
            <li key={`c${c.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
              <span className="text-[11px] text-muted">Exit criterion · {stageLabel(c.stage)}</span>
              <span className="min-w-0 flex-1">{c.body}</span>
              {canEdit && (
                <span className="flex gap-3 text-[11px]">
                  <button onClick={() => call(`/api/criteria/${c.id}`, 'PATCH', { accept: true })} disabled={busy} className={BUTTON_PRIMARY}>
                    Accept
                  </button>
                  <button onClick={() => call(`/api/criteria/${c.id}`, 'PATCH', { reject: true })} disabled={busy} className={BUTTON_DANGER}>
                    Reject
                  </button>
                </span>
              )}
            </li>
          ))}
          {proposedCards.map((c) => (
            <li key={`k${c.id}`} className="py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[11px] text-muted">
                  Card · {stageLabel(c.stage)} · {describeElement(elementName(c.elementId))}
                  {c.kind ? ` · ${c.kind}` : ''}
                </span>
                <span className="min-w-0 flex-1">{c.what}</span>
                {canChange(c) && (
                  <span className="flex gap-3 text-[11px]">
                    <button onClick={() => call(`/api/cards/${c.id}`, 'PATCH', { status: 'accepted' })} disabled={busy} className={BUTTON_PRIMARY}>
                      Accept
                    </button>
                    <button onClick={() => call(`/api/cards/${c.id}`, 'PATCH', { status: 'rejected' })} disabled={busy} className={BUTTON_DANGER}>
                      Reject
                    </button>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted">Done when: {c.doneWhen}</p>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  // ── Left column: the current stage ───────────────────────────────────────────
  const aside = (
    <>
      <Section label={`Stage · ${stageLabel(current)}`}>
        <div className="t-body">
          {w.enteredAt && <p className="mb-2 text-[11px] text-muted">Since {formatWhen(w.enteredAt)}</p>}
          <p className="t-label mb-1">Exit criteria</p>
          {criteria.length === 0 ? (
            <p className="text-muted">
              None yet. {canEdit ? 'Write what finishes this stage before working in it.' : ''}
            </p>
          ) : (
            <ul className="space-y-1">
              {criteria.map((c) => (
                <CriterionRow key={c.id} c={c} canEdit={canEdit} isOwner={isOwner} busy={busy} call={call} />
              ))}
            </ul>
          )}
          {canEdit && <AddLine placeholder="This stage is finished when…" busy={busy} onAdd={(body) => call(`/api/projects/${projectId}/criteria`, 'POST', { stage: current, body })} />}

          {canEdit && next && (
            <div className="mt-4">
              <button
                onClick={() => call(`/api/projects/${projectId}/workflow`, 'POST', { op: 'move', to: next.key })}
                disabled={busy || unmet > 0}
                className={BUTTON}
                title={unmet > 0 ? `${unmet} exit ${unmet === 1 ? 'criterion is' : 'criteria are'} not met` : undefined}
              >
                Advance to {next.label} →
              </button>
              {unmet > 0 && <p className="mt-1 text-[11px] text-muted">{unmet} still to meet.</p>}
            </div>
          )}
          {canEdit && pos > 1 && <MoveBack w={w} busy={busy} onMove={(to, reason) => call(`/api/projects/${projectId}/workflow`, 'POST', { op: 'move', to, reason })} />}
        </div>
      </Section>

      <Section label="Moves">
        <ul className="t-body space-y-1.5">
          {w.moves.map((m) => (
            <li key={m.id}>
              <span>{m.fromStage ? `${stageLabel(m.fromStage)} → ${stageLabel(m.toStage)}` : `Started at ${stageLabel(m.toStage)}`}</span>
              <span className="block text-[11px] text-muted">
                {m.movedByName} · {formatWhen(m.movedAt)}
              </span>
              {m.reason && <span className="block text-[11px] italic text-muted">“{m.reason}”</span>}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );

  // ── Main column ───────────────────────────────────────────────────────────────
  const groups = [...tops.map((t) => t.name), 'Unassigned'];
  const byTop = (cards: WorkflowCard[]) => {
    const m = new Map<string, WorkflowCard[]>();
    for (const c of cards) {
      const top = elementName(c.elementId).top;
      m.set(top, [...(m.get(top) ?? []), c]);
    }
    return m;
  };
  const openByTop = byTop(openHere);

  const main = (
    <>
      <Section label={`Open work · ${stageLabel(current)} · ${openHere.length}`}>
        {canContribute && (
          <CardForm
            elements={w.elements}
            stages={w.stages.filter((s) => s.position >= pos)}
            defaultStage={current}
            busy={busy}
            submitLabel="Add card"
            onSubmit={(input) => call(`/api/projects/${projectId}/cards`, 'POST', input)}
          />
        )}
        {openHere.length === 0 ? (
          <p className="t-body mt-3 text-muted">No open cards in this stage.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {groups
              .filter((g) => openByTop.has(g))
              .map((g) => (
                <div key={g}>
                  <h3 className="t-label mb-1">{g}</h3>
                  <ul className="divide-y divide-line border-y border-line">
                    {openByTop.get(g)!.map((c) => (
                      <CardRow key={c.id} c={c} {...cardProps} elements={w.elements} stages={w.stages} />
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
        {doneHere.length > 0 && (
          <details className="t-body mt-4">
            <summary className="cursor-pointer text-muted">Done in this stage · {doneHere.length}</summary>
            <ul className="mt-1 divide-y divide-line">
              {doneHere.map((c) => (
                <CardRow key={c.id} c={c} {...cardProps} elements={w.elements} stages={w.stages} />
              ))}
            </ul>
          </details>
        )}
      </Section>

      {parked.length > 0 && (
        <Section
          className="scroll-mt-4"
          label={<span id="parked-cards">Parked for later stages · {parked.length}</span>}
          action={
            <button onClick={() => (parkedOpen ? setParkedOpen(false) : openParked(null))} className={BUTTON}>
              {parkedOpen ? 'Hide' : 'Show'}
            </button>
          }
        >
          {!parkedOpen ? (
            <p className="t-body text-muted">
              Held out of view until their stage begins. Open them here or from a stage above to read or edit them.
            </p>
          ) : (
          <div className="space-y-4">
            {parkedFocus && (
              <button onClick={() => setParkedFocus(null)} className={BUTTON}>
                Show every later stage
              </button>
            )}
            {w.stages
              .filter((s) => s.position > pos && parked.some((c) => c.stage === s.key))
              .filter((s) => !parkedFocus || s.key === parkedFocus)
              .map((s) => (
                <div key={s.key}>
                  <h3 className="t-label mb-1">{s.label}</h3>
                  <ul className="divide-y divide-line border-y border-line">
                    {parked
                      .filter((c) => c.stage === s.key)
                      .map((c) => (
                        <CardRow key={c.id} c={c} {...cardProps} elements={w.elements} stages={w.stages} />
                      ))}
                  </ul>
                </div>
              ))}
          </div>
          )}
        </Section>
      )}

      <Section label={`Settled decisions · ${settled.length}`}>
        {settled.length === 0 ? (
          <p className="t-body text-muted">None yet. Mark a card or a note settled so it is not reopened without a reason.</p>
        ) : (
          <ul className="t-body divide-y divide-line">
            {settled.map((c) => (
              <SettledRow key={c.id} c={c} elementName={elementName} canEdit={canEdit} busy={busy} call={call} />
            ))}
          </ul>
        )}
      </Section>

      <Section label="Elements">
        <ElementTree projectId={projectId} elements={w.elements} canEdit={canEdit} isOwner={isOwner} busy={busy} call={call} />
      </Section>
    </>
  );

  return (
    <>
      {strip}
      {review}
      {error && <p className="t-body mb-4 text-rust">{error}</p>}
      <DetailGrid main={main} aside={aside} side="left" />
    </>
  );
}

function describeElement(e: { top: string; part: string | null }): string {
  return e.part ? `${e.top} › ${e.part}` : e.top;
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

type Call = (url: string, method: string, body?: unknown) => Promise<boolean>;

function CriterionRow({ c, canEdit, isOwner, busy, call }: { c: ExitCriterion; canEdit: boolean; isOwner: boolean; busy: boolean; call: Call }) {
  return (
    <li className="flex items-baseline gap-2">
      <input
        type="checkbox"
        checked={!!c.metAt}
        disabled={!canEdit || busy}
        onChange={(e) => call(`/api/criteria/${c.id}`, 'PATCH', { met: e.target.checked })}
        aria-label={c.body}
        className="translate-y-0.5"
      />
      <span className={`min-w-0 flex-1 ${c.metAt ? 'text-muted line-through' : ''}`} title={c.metAt ? `Met · ${c.metByName ?? ''} · ${formatWhen(c.metAt)}` : undefined}>
        {c.body}
      </span>
      {isOwner && (
        <button onClick={() => call(`/api/criteria/${c.id}`, 'DELETE')} disabled={busy} className={BUTTON_DANGER} aria-label="Delete criterion">
          ×
        </button>
      )}
    </li>
  );
}

function AddLine({ placeholder, busy, onAdd }: { placeholder: string; busy: boolean; onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onAdd(text)) setText('');
      }}
      className="mt-2 flex gap-2"
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className={`${FIELD} min-w-0 flex-1`} />
      <button type="submit" disabled={busy || !text.trim()} className={BUTTON}>
        Add
      </button>
    </form>
  );
}

function MoveBack({ w, busy, onMove }: { w: Workflow; busy: boolean; onMove: (to: string, reason: string) => Promise<boolean> }) {
  const pos = stagePosition(w, w.stage);
  const earlier = w.stages.filter((s) => s.position < pos);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(earlier[earlier.length - 1]?.key ?? '');
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={`mt-3 ${BUTTON}`}>
        Move back to an earlier stage…
      </button>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onMove(to, reason)) {
          setOpen(false);
          setReason('');
        }
      }}
      className="mt-3 space-y-2"
    >
      <select value={to} onChange={(e) => setTo(e.target.value)} className={`${FIELD} w-full`} aria-label="Stage to move back to">
        {earlier.map((s) => (
          <option key={s.key} value={s.key}>
            Back to {s.label}
          </option>
        ))}
      </select>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why (kept with the move)" className={`${FIELD} w-full`} />
      <div className="flex gap-3">
        <button type="submit" disabled={busy || !reason.trim()} className={BUTTON}>
          Move back
        </button>
        <button type="button" onClick={() => setOpen(false)} className={BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type CardInput = { stage: string; elementId: number | null; kind: CardKind | null; what: string; doneWhen: string };

function ElementOptions({ elements }: { elements: WorkflowElement[] }) {
  const tops = elements.filter((e) => e.parentId === null).sort((a, b) => a.position - b.position);
  return (
    <>
      <option value="">No element</option>
      {tops.map((t) => (
        <optgroup key={t.id} label={t.name}>
          <option value={t.id}>{t.name}</option>
          {elements
            .filter((e) => e.parentId === t.id)
            .sort((a, b) => a.position - b.position)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {t.name} › {e.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

function CardForm({
  elements,
  stages,
  defaultStage,
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  elements: WorkflowElement[];
  stages: Workflow['stages'];
  defaultStage: string;
  initial?: CardInput;
  busy: boolean;
  submitLabel: string;
  onSubmit: (input: CardInput) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(!!initial);
  const [stage, setStage] = useState(initial?.stage ?? defaultStage);
  const [elementId, setElementId] = useState<number | null>(initial?.elementId ?? null);
  const [kind, setKind] = useState<CardKind | null>(initial?.kind ?? null);
  const [what, setWhat] = useState(initial?.what ?? '');
  const [doneWhen, setDoneWhen] = useState(initial?.doneWhen ?? '');

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={BUTTON}>
        + Add a card
      </button>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSubmit({ stage, elementId, kind, what, doneWhen })) {
          if (initial) return;
          setWhat('');
          setDoneWhen('');
          setOpen(false);
        }
      }}
      className="t-body space-y-2 rounded border border-line bg-card p-2"
    >
      <textarea value={what} onChange={(e) => setWhat(e.target.value)} rows={2} placeholder="What needs to happen" className={`${FIELD} w-full`} autoFocus />
      <textarea value={doneWhen} onChange={(e) => setDoneWhen(e.target.value)} rows={2} placeholder="How you will know it is done" className={`${FIELD} w-full`} />
      <div className="flex flex-wrap items-center gap-2">
        <select value={elementId ?? ''} onChange={(e) => setElementId(e.target.value ? Number(e.target.value) : null)} className={FIELD} aria-label="Element">
          <ElementOptions elements={elements} />
        </select>
        <select value={kind ?? ''} onChange={(e) => setKind((e.target.value || null) as CardKind | null)} className={FIELD} aria-label="Kind">
          <option value="">No kind</option>
          {CARD_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={FIELD} aria-label="Stage">
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.key === defaultStage && !initial ? `${s.label} (now)` : s.label}
            </option>
          ))}
        </select>
        <span className="ml-auto flex gap-3">
          <button type="button" onClick={() => (onCancel ? onCancel() : setOpen(false))} className={BUTTON}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !what.trim() || !doneWhen.trim()} className={BUTTON}>
            {submitLabel}
          </button>
        </span>
      </div>
    </form>
  );
}

function CardRow({
  c,
  elements,
  stages,
  elementName,
  stageLabel,
  canChange,
  canEdit,
  isOwner,
  busy,
  call,
}: {
  c: WorkflowCard;
  elements: WorkflowElement[];
  stages: Workflow['stages'];
  elementName: (id: number | null) => { top: string; part: string | null };
  stageLabel: (key: string) => string;
  canChange: (c: WorkflowCard) => boolean;
  canEdit: boolean;
  isOwner: boolean;
  busy: boolean;
  call: Call;
}) {
  const [editing, setEditing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [reason, setReason] = useState('');
  const el = elementName(c.elementId);
  const changeable = canChange(c);

  if (editing) {
    return (
      <li className="py-2">
        <CardForm
          elements={elements}
          stages={stages}
          defaultStage={c.stage}
          initial={{ stage: c.stage, elementId: c.elementId, kind: c.kind, what: c.what, doneWhen: c.doneWhen }}
          busy={busy}
          submitLabel="Save"
          onSubmit={async (input) => {
            const ok = await call(`/api/cards/${c.id}`, 'PATCH', input);
            if (ok) setEditing(false);
            return ok;
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="t-body py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`min-w-0 flex-1 ${c.status === 'done' ? 'text-muted line-through' : ''}`}>{c.what}</span>
        {changeable ? (
          <select
            value={c.status}
            onChange={(e) => call(`/api/cards/${c.id}`, 'PATCH', { status: e.target.value as CardStatus })}
            disabled={busy}
            className={`${FIELD} text-[11px]`}
            aria-label="Status"
          >
            {PERSON_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] text-muted">{c.status}</span>
        )}
      </div>
      <p className="text-[11px] text-muted">Done when: {c.doneWhen}</p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
        {el.part && <span>{el.part}</span>}
        {c.kind && <span>· {c.kind}</span>}
        {c.audioLabel !== null && (
          <span>
            · {c.audioLabel}
            {c.positionS !== null ? ` at ${formatMoment(c.positionS)}` : ''}
          </span>
        )}
        {c.origin === 'assistant' && <span>· from Claude</span>}
        <span>· {c.createdByName}</span>
        {c.reopenCount > 0 && <span>· reopened {c.reopenCount}×</span>}
        <span className="ml-auto flex gap-3">
          {changeable && (
            <button onClick={() => setEditing(true)} className={BUTTON}>
              Edit
            </button>
          )}
          {canEdit && (
            <button onClick={() => setSettling((s) => !s)} className={BUTTON}>
              Settle
            </button>
          )}
          {isOwner && (
            <button onClick={() => call(`/api/cards/${c.id}`, 'DELETE')} disabled={busy} className={BUTTON_DANGER}>
              Delete
            </button>
          )}
        </span>
      </div>
      {settling && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call(`/api/cards/${c.id}`, 'POST', { op: 'settle', reason })) setSettling(false);
          }}
          className="mt-1.5 flex gap-2"
        >
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Why it is settled (optional) · ${stageLabel(c.stage)}`} className={`${FIELD} min-w-0 flex-1`} autoFocus />
          <button type="submit" disabled={busy} className={BUTTON}>
            Mark settled
          </button>
        </form>
      )}
    </li>
  );
}

function SettledRow({
  c,
  elementName,
  canEdit,
  busy,
  call,
}: {
  c: WorkflowCard;
  elementName: (id: number | null) => { top: string; part: string | null };
  canEdit: boolean;
  busy: boolean;
  call: Call;
}) {
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li className="py-2">
      <p>{c.what}</p>
      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
        <span>{describeElement(elementName(c.elementId))}</span>
        {c.settledReason && <span>· “{c.settledReason}”</span>}
        {c.settledAt && <span>· settled {formatWhen(c.settledAt)}</span>}
        {c.sourceNoteId !== null && <span>· from a note</span>}
        {c.reopenCount > 0 && <span>· reopened {c.reopenCount}× before</span>}
        {canEdit && (
          <button onClick={() => setReopening((r) => !r)} className={`ml-auto ${BUTTON}`}>
            Reopen
          </button>
        )}
      </div>
      {reopening && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call(`/api/cards/${c.id}`, 'POST', { op: 'reopen', reason })) setReopening(false);
          }}
          className="mt-1.5 flex gap-2"
        >
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why reopen it (kept, and counted)" className={`${FIELD} min-w-0 flex-1`} autoFocus />
          <button type="submit" disabled={busy || !reason.trim()} className={BUTTON}>
            Reopen
          </button>
        </form>
      )}
    </li>
  );
}

function ElementTree({
  projectId,
  elements,
  canEdit,
  isOwner,
  busy,
  call,
}: {
  projectId: number;
  elements: WorkflowElement[];
  canEdit: boolean;
  isOwner: boolean;
  busy: boolean;
  call: Call;
}) {
  const [editing, setEditing] = useState(false);
  const tops = elements.filter((e) => e.parentId === null).sort((a, b) => a.position - b.position);
  const children = (id: number) => elements.filter((e) => e.parentId === id).sort((a, b) => a.position - b.position);

  if (!editing) {
    return (
      <div className="t-body">
        <ul className="space-y-1">
          {tops.map((t) => (
            <li key={t.id}>
              <span className="font-medium">{t.name}</span>
              {children(t.id).length > 0 && <span className="text-muted"> · {children(t.id).map((c) => c.name).join(', ')}</span>}
            </li>
          ))}
        </ul>
        {canEdit && (
          <button onClick={() => setEditing(true)} className={`mt-2 ${BUTTON}`}>
            Edit elements
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="t-body">
      <ul className="space-y-2">
        {tops.map((t) => (
          <li key={t.id}>
            <ElementLine e={t} isOwner={isOwner} busy={busy} call={call} strong />
            <ul className="mt-1 space-y-1 pl-4">
              {children(t.id).map((c) => (
                <li key={c.id}>
                  <ElementLine e={c} isOwner={isOwner} busy={busy} call={call} />
                </li>
              ))}
              <li>
                <AddLine placeholder={`A part of ${t.name}`} busy={busy} onAdd={(name) => call(`/api/projects/${projectId}/elements`, 'POST', { name, parentId: t.id })} />
              </li>
            </ul>
          </li>
        ))}
      </ul>
      <AddLine placeholder="A new top-level element" busy={busy} onAdd={(name) => call(`/api/projects/${projectId}/elements`, 'POST', { name })} />
      <button onClick={() => setEditing(false)} className={`mt-2 ${BUTTON}`}>
        Done editing
      </button>
      {isOwner && <p className="mt-1 text-[11px] text-muted">Deleting an element deletes the parts under it; their cards stay, without an element.</p>}
    </div>
  );
}

function ElementLine({ e, isOwner, busy, call, strong = false }: { e: WorkflowElement; isOwner: boolean; busy: boolean; call: Call; strong?: boolean }) {
  const [name, setName] = useState(e.name);
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        if (name.trim() && name.trim() !== e.name) void call(`/api/elements/${e.id}`, 'PATCH', { name });
      }}
      className="flex items-center gap-2"
    >
      <input
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        onBlur={() => {
          if (name.trim() && name.trim() !== e.name) void call(`/api/elements/${e.id}`, 'PATCH', { name });
        }}
        className={`${FIELD} w-56 ${strong ? 'font-medium' : ''}`}
        aria-label="Element name"
      />
      {isOwner && (
        <button type="button" onClick={() => call(`/api/elements/${e.id}`, 'DELETE')} disabled={busy} className={BUTTON_DANGER}>
          Delete
        </button>
      )}
    </form>
  );
}

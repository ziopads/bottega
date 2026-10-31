'use client';

import { useMemo, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { formatMoment, formatWhen } from '@/app/_studio/Notes';
import { DetailGrid, Section } from '@/app/_ui/layout';
import type { StudioNote } from '@/lib/studioTypes';
import { DONE_WHEN_UNWRITTEN } from '@/lib/workflowInput';
import {
  CARD_KINDS,
  PERSON_STATUSES,
  stagePosition,
  type CheckResult,
  type CardKind,
  type CardStatus,
  type ExitCriterion,
  type Workflow,
  type WorkflowCard,
  type WorkflowElement,
  type WorkflowLearning,
} from '@/lib/workflowTypes';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';
import { elementColor } from '@/lib/elementColors';
import Method from '@/app/_ui/Method';

// The Workflow tab (REQUIREMENTS W-1 to W-24, db/011, db/024), from 23 October:
//
//   stage bar       one segment per stage, filled by the share of its criteria
//                   met, the current one outlined, labels and a caption
//   (the next to-do heads On deck; the summary of where the project stands is
//   on the Overview tab: WhereItStands.tsx)
//   template        what the project's template offers since it was taken
//   review band     Claude's proposals, waiting for a person
//   left column     the stages, each with its share met and parked cards
//   middle column   the chosen stage: its standard and criteria with hints,
//                   and its learnings from the template (W-33, db/028); the
//                   current stage follows the criteria, there is no button for it
//   right column    the current stage's cards by element, each movable to a
//                   note or a learning (W-34); folded below, done
//                   cards, cards waiting for later stages, settled decisions,
//                   the session log and the element tree
//
// General to detail, left to right.
// What the controls offer follows the viewer's level; the routes and db/011
// enforce the same rules. Every change answers with the whole workflow.

const FIELD = 'rounded border border-line bg-card px-1.5 py-0.5 outline-none focus:border-rust';

type Props = {
  projectId: number;
  workflow: Workflow;
  setWorkflow: (w: Workflow) => void;
  /** A card moved to a note changes the Notes tab too. */
  setNotes?: (notes: StudioNote[]) => void;
  viewerId: string;
  canContribute: boolean;
  canEdit: boolean;
  isOwner: boolean;
};

export default function WorkflowTab({ projectId, workflow: w, setWorkflow, setNotes, viewerId, canContribute, canEdit, isOwner }: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setError('');
    setBusy(true);
    const r = await api<{ workflow: Workflow; notes?: StudioNote[] }>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'That did not go through.');
      return false;
    }
    setWorkflow(r.data.workflow);
    if (r.data.notes && setNotes) setNotes(r.data.notes);
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
                The workflow keeps track of where this project stands: one stage at a time ({w.stages.map((s) => s.label).join(', ')}),
                each finished when its exit criteria are met, with the open work on each part of the track as cards.
              </p>
              {canEdit ? (
                <StartForm
                  w={w}
                  busy={busy}
                  onStart={(templateId, structureId) => call(`/api/projects/${projectId}/workflow`, 'POST', { op: 'start', templateId, structureId })}
                />
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
  const last = w.stages[w.stages.length - 1];
  const url = `/api/projects/${projectId}/workflow`;

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
  const accepted = w.criteria.filter((c) => c.reviewed && !c.rejected);
  const tally = (key: string) => {
    const cs = accepted.filter((c) => c.stage === key);
    return { met: cs.filter((c) => c.metAt).length, total: cs.length };
  };
  // Criteria ticked and to-dos done over both, which is what completes a stage.
  const stageTally = (key: string) => {
    const c = tally(key);
    const ks = live.filter((k) => k.stage === key);
    return { met: c.met + ks.filter((k) => k.status === 'done').length, total: c.total + ks.length };
  };

  // The stage shown in the middle column: the current one unless another is picked.
  const [picked, setPicked] = useState<string | null>(null);
  const sel = w.stages.find((s) => s.key === picked) ?? w.stages.find((s) => s.key === current) ?? w.stages[0];
  const selTally = tally(sel.key);
  const selCriteria = accepted.filter((c) => c.stage === sel.key);
  const selParked = parked.filter((c) => c.stage === sel.key);

  const canChange = (c: WorkflowCard) => canEdit || (canContribute && c.createdById === viewerId);
  const cardProps = { elementName, stageLabel, canChange, canEdit, isOwner, busy, call, learningsEditable: w.learningsEditable, projectUrl: url };

  // ── Claude's proposals ──────────────────────────────────────────────────────
  const review =
    proposedCards.length + proposedCriteria.length > 0 ? (
      <div className="t-body mb-6 rounded border border-line bg-card px-3 py-2">
        <p className="t-label mb-1">Proposed by Claude · {proposedCards.length + proposedCriteria.length} waiting</p>
        <ul className="divide-y divide-line">
          {proposedCriteria.map((c) => (
            <li key={`c${c.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
              <span className="t-small text-muted">Exit criterion · {stageLabel(c.stage)}</span>
              <span className="min-w-0 flex-1">{c.body}</span>
              {canEdit && (
                <span className="flex gap-3 t-small">
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
                <span className="t-small text-muted">
                  Card · {stageLabel(c.stage)} · {describeElement(elementName(c.elementId))}
                  {c.kind ? ` · ${c.kind}` : ''}
                </span>
                <span className="min-w-0 flex-1">{c.what}</span>
                {canChange(c) && (
                  <span className="flex gap-3 t-small">
                    <button onClick={() => call(`/api/cards/${c.id}`, 'PATCH', { status: 'accepted' })} disabled={busy} className={BUTTON_PRIMARY}>
                      Accept
                    </button>
                    <button onClick={() => call(`/api/cards/${c.id}`, 'PATCH', { status: 'rejected' })} disabled={busy} className={BUTTON_DANGER}>
                      Reject
                    </button>
                  </span>
                )}
              </div>
              <p className="t-small text-muted">Done when: {c.doneWhen}</p>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  // ── Left column: the stages ─────────────────────────────────────────────────
  const stagesColumn = (
    <nav aria-label="Stages">
      <p className="t-label mb-1">Stages</p>
      <ul className="space-y-1">
        {w.stages.map((s) => {
          const t = stageTally(s.key);
          const isCurrent = s.key === current;
          const past = s.position < pos;
          const share = t.total ? t.met / t.total : past ? 1 : 0;
          const parkedHere = parked.filter((c) => c.stage === s.key).length;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setPicked(isCurrent ? null : s.key)}
                aria-pressed={s.key === sel.key}
                aria-current={isCurrent ? 'step' : undefined}
                className={`t-body block w-full rounded border px-2.5 py-2 text-left ${s.key === sel.key ? 'border-ink' : 'border-transparent hover:border-line'}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={isCurrent ? 'font-medium' : past ? 'text-muted' : ''}>
                    {past ? '✓ ' : isCurrent ? '● ' : ''}
                    {s.label}
                  </span>
                  <span className="t-num t-small text-muted">{t.total ? `${t.met}/${t.total}` : ''}</span>
                </span>
                <span className="mt-1 block h-[3px] overflow-hidden rounded bg-led-off">
                  <span className={`block h-full ${share >= 1 ? 'bg-meter-done' : 'bg-meter-now'}`} style={{ width: `${Math.round(share * 100)}%` }} />
                </span>
                {parkedHere > 0 && <span className="mt-0.5 block t-small text-muted">{parkedHere} parked</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {w.template && <p className="mt-3 t-small text-muted">From the template “{w.template.name}”.</p>}
      <details className="mt-4">
        <summary className="t-label cursor-pointer">Moves · {w.moves.length}</summary>
        <ul className="t-body mt-2 space-y-1.5">
          {w.moves.map((m) => (
            <li key={m.id}>
              <span>{m.fromStage ? `${stageLabel(m.fromStage)} → ${stageLabel(m.toStage)}` : `Started at ${stageLabel(m.toStage)}`}</span>
              <span className="block t-small text-muted">
                {m.movedByName} · {formatWhen(m.movedAt)}
              </span>
              {m.reason && <span className="block t-small italic text-muted">“{m.reason}”</span>}
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );

  // ── Middle column: the chosen stage's criteria ──────────────────────────────
  const criteriaColumn = (
    <section aria-label={`${sel.label} criteria`}>
      <p className="t-label">
        Stage {sel.position} · {sel.label} · {selTally.met} of {selTally.total}
      </p>
      {sel.standard && <p className="mt-0.5 t-lead font-medium">{sel.standard}</p>}
      {sel.key === current && w.enteredAt && <p className="mt-0.5 t-small text-muted">Since {formatWhen(w.enteredAt)}</p>}
      {sel.position > pos && (
        <p className="mt-0.5 t-small text-muted">A later stage. Its criteria can be ticked ahead; the project moves into it once {stageLabel(current)} is complete.</p>
      )}
      {selCriteria.length === 0 ? (
        <p className="t-body mt-2 text-muted">None yet. {canEdit ? 'Write what finishes this stage.' : ''}</p>
      ) : (
        <ul className="t-body mt-2 space-y-0.5">
          {selCriteria.map((c) => (
            <CriterionRow
              key={c.id}
              c={c}
              result={c.checkKey ? w.setReading?.results[c.checkKey] : undefined}
              setDay={w.setReading?.savedAt ? formatDay(w.setReading.savedAt) : null}
              canEdit={canEdit}
              isOwner={isOwner}
              busy={busy}
              call={call}
            />
          ))}
        </ul>
      )}
      {selCriteria.some((c) => c.checkKey && !c.metAt) && w.setReading && (
        <p className="mt-1 t-small text-muted">
          {w.setReading.fileName
            ? `Marks read from the set “${w.setReading.fileName}”${w.setReading.savedAt ? `, saved ${formatDay(w.setReading.savedAt)}` : ''}. They only suggest; you tick.`
            : 'Drop the project folder on the State tab and the set will mark criteria it can read as likely done. They only suggest; you tick.'}
        </p>
      )}
      {canEdit && (
        <AddLine placeholder="This stage is finished when…" busy={busy} onAdd={(body) => call(`/api/projects/${projectId}/criteria`, 'POST', { stage: sel.key, body })} />
      )}
      <Learnings
        stageLabel={sel.label}
        templateName={w.template?.name ?? null}
        learnings={w.learnings.filter((l) => l.stage === sel.key)}
        editable={w.learningsEditable}
        busy={busy}
        onCall={(body) => call(url, 'POST', { op: 'learning', ...body })}
        onAdd={(text) => call(url, 'POST', { op: 'learning', action: 'add', stage: sel.key, body: text })}
      />
      {sel.key === current && sel.key === last?.key && w.finishedAt && <p className="t-body mt-4 font-medium">Finished {formatWhen(w.finishedAt)}.</p>}
      {sel.key !== current && (
        <button onClick={() => setPicked(null)} className={`mt-4 ${BUTTON}`}>
          Back to {stageLabel(current)}
        </button>
      )}
    </section>
  );

  // ── Right column: the current stage's cards, and what waits ──────────────────
  const groups = [...tops.map((t) => t.name), 'Unassigned'];
  const byTop = (cards: WorkflowCard[]) => {
    const m = new Map<string, WorkflowCard[]>();
    for (const c of cards) {
      const top = elementName(c.elementId).top;
      m.set(top, [...(m.get(top) ?? []), c]);
    }
    return m;
  };
  // The next to-do sits above the groups, so the column opens on it (W-39).
  const nextCard = openHere.find((c) => c.isNext) ?? null;
  const openByTop = byTop(openHere.filter((c) => !c.isNext));
  const groupColor = (name: string) => elementColor(tops.find((t) => t.name === name)?.color);
  const later = w.stages.filter((s) => s.position > pos && parked.some((c) => c.stage === s.key));

  const cardsColumn = (
    <section aria-label="Cards">
      {sel.position > pos && (
        <div className="mb-6">
          <p className="t-label mb-1">
            Parked for {sel.label} · {selParked.length}
          </p>
          {selParked.length === 0 ? (
            <p className="t-body text-muted">No cards wait for this stage.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {selParked.map((c) => (
                <CardRow key={c.id} c={c} {...cardProps} elements={w.elements} stages={w.stages} />
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="t-label">
          On deck · {stageLabel(current)} · {openHere.length}
        </p>
      </div>
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
          {nextCard && (
            <div>
              <h3 className="t-label mb-1">Next</h3>
              <ul className="divide-y divide-line border-y border-line">
                <CardRow c={nextCard} {...cardProps} elements={w.elements} stages={w.stages} />
              </ul>
            </div>
          )}
          {groups
            .filter((g) => openByTop.has(g))
            .map((g) => (
              <div key={g}>
                <h3 className="t-label mb-1 flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: groupColor(g) }} />
                  {g}
                </h3>
                <ul className="divide-y divide-line border-y border-line">
                  {openByTop.get(g)!.map((c) => (
                    <CardRow key={c.id} c={c} {...cardProps} elements={w.elements} stages={w.stages} />
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
      <div className="t-body mt-6 space-y-2 border-t border-line pt-3">
        {doneHere.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted">Done in this stage · {doneHere.length}</summary>
            <ul className="mt-1 divide-y divide-line">
              {doneHere.map((c) => (
                <CardRow key={c.id} c={c} {...cardProps} elements={w.elements} stages={w.stages} />
              ))}
            </ul>
          </details>
        )}
        {later.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted">
              Waiting for later stages · {later.map((s) => `${s.label} ${parked.filter((c) => c.stage === s.key).length}`).join(' · ')}
            </summary>
            <div className="mt-2 space-y-4">
              {later.map((s) => (
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
          </details>
        )}
        <details>
          <summary className="cursor-pointer text-muted">Settled decisions · {settled.length}</summary>
          {settled.length === 0 ? (
            <p className="mt-1 text-muted">None yet. Mark a card or a note settled so it is not reopened without a reason.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {settled.map((c) => (
                <SettledRow key={c.id} c={c} elementName={elementName} canEdit={canEdit} busy={busy} call={call} />
              ))}
            </ul>
          )}
        </details>
        <details>
          <summary className="cursor-pointer text-muted">Sessions ended by hand · {w.workLog.length}</summary>
          {w.workLog.length === 0 ? (
            <p className="mt-1 text-muted">None. Sessions are read from the saved sets: the header shows the last one.</p>
          ) : (
            <ul className="mt-1 space-y-2">
              {w.workLog.map((e) => (
                <li key={e.id}>
                  <span className="t-num block t-small text-muted">
                    {formatWhen(e.loggedAt)} · {e.loggedByName}
                  </span>
                  {e.did && <span className="block">{e.did}</span>}
                  {e.nextMove && <span className="block text-muted">Next: {e.nextMove}</span>}
                </li>
              ))}
            </ul>
          )}
        </details>
        <details>
          <summary className="cursor-pointer text-muted">Elements</summary>
          <div className="mt-2">
            <ElementTree projectId={projectId} elements={w.elements} canEdit={canEdit} isOwner={isOwner} busy={busy} call={call} />
          </div>
        </details>
      </div>
    </section>
  );

  return (
    <>
      <StageBar w={w} tally={stageTally} />
      <TemplateReview key={w.template?.version ?? 0} w={w} url={url} canEdit={canEdit} busy={busy} call={call} />
      <StructureReview key={`s${w.structure?.version ?? 0}`} w={w} url={url} canEdit={canEdit} busy={busy} call={call} />
      {review}
      {error && <p className="t-body mb-4 text-rust">{error}</p>}
      <div className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-3">{stagesColumn}</div>
        <div className="min-w-0 lg:col-span-4">{criteriaColumn}</div>
        <div className="min-w-0 lg:col-span-5">{cardsColumn}</div>
      </div>
      <Method principles={w.method} editHref={w.learningsEditable ? '/account?tab=preferences#template' : undefined} />
    </>
  );
}

/** One segment per stage, filled by the share of its criteria and to-dos done; the current one outlined (W-24). */
function StageBar({ w, tally }: { w: Workflow; tally: (key: string) => { met: number; total: number } }) {
  const pos = stagePosition(w, w.stage);
  const cur = w.stages.find((s) => s.key === w.stage);
  const all = w.stages.map((s) => tally(s.key));
  const met = all.reduce((n, t) => n + t.met, 0);
  const total = all.reduce((n, t) => n + t.total, 0);
  const columns = { gridTemplateColumns: `repeat(${w.stages.length}, minmax(0, 1fr))` };
  return (
    <section aria-label="Progress" className="mb-6">
      <div className="grid gap-1" style={columns}>
        {w.stages.map((s, i) => {
          const t = all[i];
          const share = t.total ? t.met / t.total : s.position < pos ? 1 : 0;
          return (
            <span key={s.key} className={`relative block h-2.5 overflow-hidden rounded-sm bg-led-off ${s.key === w.stage ? 'ring-1 ring-meter-now' : ''}`}>
              <span className={`absolute inset-y-0 left-0 ${share >= 1 ? 'bg-meter-done' : 'bg-meter-now'}`} style={{ width: `${Math.round(share * 100)}%` }} />
            </span>
          );
        })}
      </div>
      <div className="mt-1 grid gap-1 font-mono t-small uppercase tracking-wide" style={columns}>
        {w.stages.map((s) => (
          <span key={s.key} className={`min-w-0 truncate ${s.key === w.stage ? 'font-medium text-ink' : 'text-muted'}`}>
            {s.label}
          </span>
        ))}
      </div>
      <p className="t-num mt-1 t-small text-muted">
        {w.finishedAt
          ? `Finished · ${met} of ${total} done`
          : `Stage ${pos} of ${w.stages.length} · ${cur?.label ?? ''}${cur?.standard ? `: ${cur.standard}` : ''} · ${met} of ${total} done`}
      </p>
    </section>
  );
}

/** The re-entry note and ending a session (W-19, W-20). */
/** What the track structure offers since the project took it (W-28). */
function StructureReview({ w, url, canEdit, busy, call }: { w: Workflow; url: string; canEdit: boolean; busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(w.structureChanges.map((c) => c.uid)));
  if (!w.structure || w.structureChanges.length === 0) return null;
  const n = w.structureChanges.length;
  const toggle = (uid: string) =>
    setChosen((s) => {
      const t = new Set(s);
      if (t.has(uid)) t.delete(uid);
      else t.add(uid);
      return t;
    });
  return (
    <section aria-label="Track structure changes" className="t-body mb-6 rounded border border-line px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="t-label">
          The track structure “{w.structure.name}” has changed · {n} to review
        </p>
        <button onClick={() => setOpen((o) => !o)} className={BUTTON}>
          {open ? 'Hide' : 'Review'}
        </button>
      </div>
      {open && (
        <>
          <ul className="mt-2 divide-y divide-line">
            {w.structureChanges.map((c) => (
              <li key={c.uid} className="flex items-start gap-2 py-1.5">
                {canEdit && <input type="checkbox" checked={chosen.has(c.uid)} onChange={() => toggle(c.uid)} aria-label={c.name} className="mt-1" />}
                <div className="min-w-0 flex-1">
                  <span className="block t-small text-muted">
                    {c.change === 'new' ? 'New' : 'Changed'}
                    {c.parentName ? ` · part of ${c.parentName}` : ''}
                  </span>
                  <span className="block font-mono t-small">{c.now}</span>
                  {c.was && <span className="block font-mono t-small text-muted line-through">{c.was}</span>}
                </div>
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={() => call(url, 'POST', { op: 'structure', uids: [...chosen] })} disabled={busy || chosen.size === 0} className={BUTTON_PRIMARY}>
                Bring in {chosen.size}
              </button>
              <button onClick={() => call(url, 'POST', { op: 'structure', uids: [] })} disabled={busy} className={BUTTON}>
                Dismiss all
              </button>
              <span className="t-small text-muted">Cards stay on their elements. The State tab reads the project&rsquo;s sets with the zones it has.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** What the template offers since the project took it (W-17). */
function TemplateReview({ w, url, canEdit, busy, call }: { w: Workflow; url: string; canEdit: boolean; busy: boolean; call: Call }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(w.templateChanges.map((c) => c.uid)));
  if (!w.template || w.templateChanges.length === 0) return null;
  const n = w.templateChanges.length;
  const toggle = (uid: string) =>
    setChosen((s) => {
      const t = new Set(s);
      if (t.has(uid)) t.delete(uid);
      else t.add(uid);
      return t;
    });
  return (
    <section aria-label="Template changes" className="t-body mb-6 rounded border border-line px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="t-label">
          The template “{w.template.name}” has changed · {n} to review
        </p>
        <button onClick={() => setOpen((o) => !o)} className={BUTTON}>
          {open ? 'Hide' : 'Review'}
        </button>
      </div>
      {open && (
        <>
          <ul className="mt-2 divide-y divide-line">
            {w.templateChanges.map((c) => (
              <li key={c.uid} className="flex items-start gap-2 py-1.5">
                {canEdit && (
                  <input type="checkbox" checked={chosen.has(c.uid)} onChange={() => toggle(c.uid)} aria-label={c.body} className="mt-1" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="block t-small text-muted">
                    {c.change === 'new' ? 'New' : 'Changed'} · {c.stageLabel}
                  </span>
                  <span className="block">{c.body}</span>
                  {c.was && c.was.body !== c.body && <span className="block t-small text-muted line-through">{c.was.body}</span>}
                  {c.hint.trim() && <HintText hint={c.hint} />}
                </div>
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={() => call(url, 'POST', { op: 'template', uids: [...chosen] })} disabled={busy || chosen.size === 0} className={BUTTON_PRIMARY}>
                Bring in {chosen.size}
              </button>
              <button onClick={() => call(url, 'POST', { op: 'template', uids: [] })} disabled={busy} className={BUTTON}>
                Dismiss all
              </button>
              <span className="t-small text-muted">A changed criterion keeps whether it is met. Dismissed ones come back only when the template changes again.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function describeElement(e: { top: string; part: string | null }): string {
  return e.part ? `${e.top} › ${e.part}` : e.top;
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

type Call = (url: string, method: string, body?: unknown) => Promise<boolean>;

/** A hint's lines; each two spaces of indent nest one level (W-14). */
function HintText({ hint }: { hint: string }) {
  type Node = { text: string; children: Node[] };
  const lines = hint.split('\n').filter((l) => l.trim());
  if (lines.length <= 1) return <span className="block t-small text-muted">{hint.trim()}</span>;
  const root: Node = { text: '', children: [] };
  const stack: { depth: number; node: Node }[] = [{ depth: -1, node: root }];
  for (const l of lines) {
    const depth = Math.floor((l.length - l.trimStart().length) / 2);
    const node: Node = { text: l.trim(), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  }
  const list = (nodes: Node[]) => (
    <ul className="list-disc pl-4">
      {nodes.map((n, i) => (
        <li key={i}>
          {n.text}
          {n.children.length > 0 && list(n.children)}
        </li>
      ))}
    </ul>
  );
  return <div className="t-small text-muted">{list(root.children)}</div>;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const VERDICT: Record<CheckResult['verdict'], string> = { likely: 'Likely done', 'not yet': 'Likely not yet', unknown: 'Cannot tell from the set' };

function CriterionRow({
  c,
  result,
  setDay,
  canEdit,
  isOwner,
  busy,
  call,
}: {
  c: ExitCriterion;
  result: CheckResult | undefined;
  setDay: string | null;
  canEdit: boolean;
  isOwner: boolean;
  busy: boolean;
  call: Call;
}) {
  return (
    <li className="flex items-start gap-2 rounded px-1 py-1.5 hover:bg-ink/5">
      <input
        id={`criterion-${c.id}`}
        type="checkbox"
        checked={!!c.metAt}
        disabled={!canEdit || busy}
        onChange={(e) => call(`/api/criteria/${c.id}`, 'PATCH', { met: e.target.checked })}
        className="mt-1"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={`criterion-${c.id}`} className={`block ${c.metAt ? 'text-muted line-through' : 'font-medium'}`}>
          {c.body}
        </label>
        {c.hint.trim() && <HintText hint={c.hint} />}
        {result && !c.metAt && (
          <span
            className={`mt-1 inline-block rounded-[3px] border px-1.5 py-px font-mono t-small ${
              result.verdict === 'likely' ? 'border-dashed border-live text-live' : 'border-dashed border-ink/30 text-muted'
            }`}
          >
            {VERDICT[result.verdict]}
            {setDay && result.verdict !== 'unknown' ? ` · set ${setDay}` : ''}: {result.reading}
          </span>
        )}
        {c.metAt && (
          <span className="block t-small text-muted">
            Met · {c.metByName ?? ''} · {formatWhen(c.metAt)}
          </span>
        )}
      </div>
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
  learningsEditable,
  projectUrl,
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
  learningsEditable: boolean;
  /** The project's workflow route, for marking a to-do next. */
  projectUrl: string;
}) {
  const [editing, setEditing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [learning, setLearning] = useState(false);
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
        <span className={`min-w-0 flex-1 ${c.status === 'done' ? 'text-muted line-through' : ''}`}>
          {c.isNext && <span className="mr-1.5 rounded bg-ink px-1 py-px font-mono t-small uppercase tracking-wide text-parchment">Next</span>}
          {c.what}
        </span>
        {changeable ? (
          <select
            value={c.status}
            onChange={(e) => call(`/api/cards/${c.id}`, 'PATCH', { status: e.target.value as CardStatus })}
            disabled={busy}
            className={`${FIELD} t-small`}
            aria-label="Status"
          >
            {PERSON_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span className="t-small text-muted">{c.status}</span>
        )}
      </div>
      <p className="t-small text-muted">
        {c.doneWhen === DONE_WHEN_UNWRITTEN ? <span className="italic">Done when: not written yet{changeable ? ' · Edit to add it' : ''}</span> : `Done when: ${c.doneWhen}`}
      </p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 t-small text-muted">
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
          {changeable && !c.isNext && (c.status === 'accepted' || c.status === 'in progress') && (
            <button onClick={() => call(projectUrl, 'POST', { op: 'next-card', cardId: c.id })} disabled={busy} className={BUTTON} title="Start with this one next time">
              Make next
            </button>
          )}
          {changeable && c.status !== 'proposed' && c.status !== 'rejected' && (
            <button onClick={() => call(`/api/cards/${c.id}/move`, 'POST', { to: 'note' })} disabled={busy} className={BUTTON} title="Make it a note: its element, stage and done-when are dropped">
              → Note
            </button>
          )}
          {changeable && learningsEditable && c.status !== 'proposed' && c.status !== 'rejected' && (
            <button onClick={() => setLearning((v) => !v)} className={BUTTON} title="Keep it on the template for every project at a stage">
              → Learning
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
      {learning && (
        <LearningMove
          text={c.what}
          stages={stages}
          stage={c.stage}
          busy={busy}
          onMove={(stage, body) => call(`/api/cards/${c.id}/move`, 'POST', { to: 'learning', stage, body })}
          onCancel={() => setLearning(false)}
        />
      )}
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
      <div className="flex flex-wrap items-baseline gap-x-2 t-small text-muted">
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
              {t.color && <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: elementColor(t.color) }} aria-hidden />}
              <span className="font-medium">{t.name}</span>
              {t.isZone && t.prefixes.length > 0 && <span className="ml-1.5 font-mono t-small text-muted">{t.prefixes.join(', ')}</span>}
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
      {isOwner && <p className="mt-1 t-small text-muted">Deleting an element deletes the parts under it; their cards stay, without an element.</p>}
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

/** The template's learnings for one stage (W-33): reminders with no checkbox, the same on every project using the template. */
function Learnings({
  stageLabel,
  templateName,
  learnings,
  editable,
  busy,
  onCall,
  onAdd,
}: {
  stageLabel: string;
  templateName: string | null;
  learnings: WorkflowLearning[];
  editable: boolean;
  busy: boolean;
  onCall: (body: { action: 'edit' | 'accept' | 'delete'; id: number; body?: string }) => Promise<boolean>;
  onAdd: (text: string) => Promise<boolean>;
}) {
  const kept = learnings.filter((l) => l.reviewed);
  const proposed = learnings.filter((l) => !l.reviewed);
  if (!kept.length && !proposed.length && !editable) return null;
  return (
    <section aria-label={`Learnings for ${stageLabel}`} className="t-body mt-5 rounded-md border border-line bg-ink/[0.03] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="t-label">
          Learnings · {stageLabel} · {kept.length}
        </p>
        {templateName && <p className="t-small text-muted">From “{templateName}” · on every project at this stage</p>}
      </div>
      {kept.length === 0 && proposed.length === 0 && (
        <p className="mt-1 t-small text-muted">
          Something worth remembering at {stageLabel} on every project. A note or a card can be moved here with → Learning.
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {kept.map((l) => (
          <LearningRow key={l.id} l={l} busy={busy} onCall={onCall} />
        ))}
        {proposed.map((l) => (
          <li key={l.id} className="space-y-1 rounded border border-dashed border-ink bg-card px-2.5 py-2">
            <p className="font-mono t-small text-muted">Proposed by Claude</p>
            <p>{l.body}</p>
            {l.canEdit && (
              <span className="flex gap-2">
                <button onClick={() => onCall({ action: 'accept', id: l.id })} disabled={busy} className={BUTTON_PRIMARY}>
                  Keep
                </button>
                <button onClick={() => onCall({ action: 'delete', id: l.id })} disabled={busy} className={BUTTON_DANGER}>
                  Reject
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editable && <AddLine placeholder={`Something to remember at ${stageLabel}, on every project`} busy={busy} onAdd={onAdd} />}
    </section>
  );
}

function LearningRow({
  l,
  busy,
  onCall,
}: {
  l: WorkflowLearning;
  busy: boolean;
  onCall: (body: { action: 'edit' | 'accept' | 'delete'; id: number; body?: string }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(l.body);
  if (editing) {
    return (
      <li className="rounded border border-line bg-card px-2.5 py-2">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onCall({ action: 'edit', id: l.id, body: text })) setEditing(false);
          }}
          className="space-y-1.5"
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={`${FIELD} w-full`} aria-label="Learning" />
          <span className="flex gap-2">
            <button type="submit" disabled={busy || !text.trim()} className={BUTTON_PRIMARY}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={BUTTON}>
              Cancel
            </button>
          </span>
        </form>
      </li>
    );
  }
  return (
    <li className="space-y-0.5 rounded border border-line bg-card px-2.5 py-2">
      <p className="whitespace-pre-line">{l.body}</p>
      <p className="flex flex-wrap items-center gap-x-2 font-mono t-small text-muted">
        <span>
          {l.createdByName}
          {l.source ? ` · from ${l.source}` : ''} · {formatDay(l.createdAt)}
        </span>
        {l.canEdit && (
          <span className="ml-auto flex gap-2 font-sans">
            <button onClick={() => setEditing(true)} className={BUTTON}>
              Edit
            </button>
            <button onClick={() => confirm('Delete this learning from the template? Every project using it loses it.') && onCall({ action: 'delete', id: l.id })} disabled={busy} className={BUTTON_DANGER}>
              Delete
            </button>
          </span>
        )}
      </p>
    </li>
  );
}

/** Moving a note or a card to a learning: the stage it is for and its wording, both changeable first. */
export function LearningMove({
  text,
  stages,
  stage,
  busy,
  onMove,
  onCancel,
}: {
  text: string;
  stages: { key: string; label: string }[];
  stage: string;
  busy: boolean;
  onMove: (stage: string, body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [to, setTo] = useState(stage);
  const [body, setBody] = useState(text);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onMove(to, body)) onCancel();
      }}
      className="mt-1.5 space-y-1.5 rounded border border-line p-2"
    >
      <p className="t-small font-medium">Make it a learning</p>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} className={`${FIELD} w-full`} aria-label="The learning" />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 t-small text-muted">
          Stage
          <select value={to} onChange={(e) => setTo(e.target.value)} className={FIELD}>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !body.trim()} className={BUTTON_PRIMARY}>
          Move to learnings
        </button>
        <button type="button" onClick={onCancel} className={BUTTON}>
          Cancel
        </button>
      </div>
      <p className="t-small text-muted">It goes on the project&rsquo;s template, shown on every project at that stage, and leaves this project.</p>
    </form>
  );
}

/** Starting the workflow: with the project's own template (its artist's, else the account's) or another (W-31). */
function StartForm({ w, busy, onStart }: { w: Workflow; busy: boolean; onStart: (templateId: number | null, structureId: number | null) => Promise<boolean> }) {
  const choices = w.startChoices;
  const [templateId, setTemplateId] = useState<number | null>(choices?.templateId ?? null);
  const [structureId, setStructureId] = useState<number | null>(choices?.structureId ?? null);
  if (!choices || (choices.templates.length <= 1 && choices.structures.length <= 1)) {
    return (
      <button onClick={() => onStart(null, null)} disabled={busy} className={BUTTON}>
        Start at {w.stages[0].label}
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onStart(templateId, structureId);
      }}
      className="space-y-2 rounded border border-ink p-3"
    >
      <label className="flex flex-col gap-0.5 t-small text-muted">
        Workflow template
        <select value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)} className={FIELD}>
          {choices.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.note}
            </option>
          ))}
        </select>
      </label>
      {choices.structures.length > 0 && (
        <label className="flex flex-col gap-0.5 t-small text-muted">
          Track structure
          <select value={structureId ?? ''} onChange={(e) => setStructureId(e.target.value ? Number(e.target.value) : null)} className={FIELD}>
            {choices.structures.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.note}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="t-small text-muted">The project gets its own copy of each; later changes to a template are offered, never forced.</p>
      <button type="submit" disabled={busy} className={BUTTON_PRIMARY}>
        Start
      </button>
    </form>
  );
}

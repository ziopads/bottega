'use client';

import { useMemo, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { formatMoment, formatWhen } from '@/app/_studio/Notes';
import { DetailGrid, Section } from '@/app/_ui/layout';
import { DONE_WHEN_UNWRITTEN } from '@/lib/workflowInput';
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

// The Workflow tab (REQUIREMENTS W-1 to W-24, db/011, db/024), from 23 October:
//
//   stage bar       one segment per stage, filled by the share of its criteria
//                   met, the current one outlined, labels and a caption
//   pick up here    the next move, the blocker, Done · pull the next card up,
//                   End session (log, next move, loose lines as cards)
//   template        what the project's template offers since it was taken
//   review band     Claude's proposals, waiting for a person
//   left column     the stages, each with its share met and parked cards
//   middle column   the chosen stage: its standard and criteria with hints;
//                   advance and move back from the current one
//   right column    the current stage's cards by element; folded below, done
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
                The workflow keeps track of where this project stands: one stage at a time ({w.stages.map((s) => s.label).join(', ')}),
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
  const unmet = accepted.filter((c) => c.stage === current && !c.metAt).length;

  // The stage shown in the middle column: the current one unless another is picked.
  const [picked, setPicked] = useState<string | null>(null);
  const sel = w.stages.find((s) => s.key === picked) ?? w.stages.find((s) => s.key === current) ?? w.stages[0];
  const selTally = tally(sel.key);
  const selCriteria = accepted.filter((c) => c.stage === sel.key);
  const selParked = parked.filter((c) => c.stage === sel.key);

  const canChange = (c: WorkflowCard) => canEdit || (canContribute && c.createdById === viewerId);
  const cardProps = { elementName, stageLabel, canChange, canEdit, isOwner, busy, call };

  // ── Claude's proposals ──────────────────────────────────────────────────────
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

  // ── Left column: the stages ─────────────────────────────────────────────────
  const stagesColumn = (
    <nav aria-label="Stages">
      <p className="t-label mb-1">Stages</p>
      <ul className="space-y-1">
        {w.stages.map((s) => {
          const t = tally(s.key);
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
                  <span className="t-num text-[10px] text-muted">{t.total ? `${t.met}/${t.total}` : ''}</span>
                </span>
                <span className="mt-1 block h-[3px] overflow-hidden rounded bg-line">
                  <span className="block h-full bg-ink" style={{ width: `${Math.round(share * 100)}%` }} />
                </span>
                {parkedHere > 0 && <span className="mt-0.5 block text-[11px] text-muted">{parkedHere} parked</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {w.template && <p className="mt-3 text-[11px] text-muted">From the template “{w.template.name}”.</p>}
      <details className="mt-4">
        <summary className="t-label cursor-pointer">Moves · {w.moves.length}</summary>
        <ul className="t-body mt-2 space-y-1.5">
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
      </details>
    </nav>
  );

  // ── Middle column: the chosen stage's criteria ──────────────────────────────
  const criteriaColumn = (
    <section aria-label={`${sel.label} criteria`}>
      <p className="t-label">
        Stage {sel.position} · {sel.label} · {selTally.met} of {selTally.total}
      </p>
      {sel.standard && <p className="mt-0.5 text-[15px] font-medium">{sel.standard}</p>}
      {sel.key === current && w.enteredAt && <p className="mt-0.5 text-[11px] text-muted">Since {formatWhen(w.enteredAt)}</p>}
      {sel.position > pos && (
        <p className="mt-0.5 text-[11px] text-muted">A later stage. Its criteria can be ticked ahead; moving into it waits on {stageLabel(current)}.</p>
      )}
      {selCriteria.length === 0 ? (
        <p className="t-body mt-2 text-muted">None yet. {canEdit ? 'Write what finishes this stage.' : ''}</p>
      ) : (
        <ul className="t-body mt-2 space-y-0.5">
          {selCriteria.map((c) => (
            <CriterionRow key={c.id} c={c} canEdit={canEdit} isOwner={isOwner} busy={busy} call={call} />
          ))}
        </ul>
      )}
      {canEdit && (
        <AddLine placeholder="This stage is finished when…" busy={busy} onAdd={(body) => call(`/api/projects/${projectId}/criteria`, 'POST', { stage: sel.key, body })} />
      )}
      {sel.key === current && canEdit && next && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <button
            onClick={() => call(url, 'POST', { op: 'move', to: next.key })}
            disabled={busy || unmet > 0}
            className={BUTTON}
            title={unmet > 0 ? `${unmet} exit ${unmet === 1 ? 'criterion is' : 'criteria are'} not met` : undefined}
          >
            Advance to {next.label} →
          </button>
          {unmet > 0 && <span className="text-[11px] text-muted">{unmet} still to meet</span>}
        </div>
      )}
      {sel.key === current && !next && w.finishedAt && <p className="t-body mt-4 font-medium">Finished {formatWhen(w.finishedAt)}.</p>}
      {sel.key === current && canEdit && pos > 1 && <MoveBack w={w} busy={busy} onMove={(to, reason) => call(url, 'POST', { op: 'move', to, reason })} />}
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
  const openByTop = byTop(openHere);
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
          <summary className="cursor-pointer text-muted">Session log · {w.workLog.length}</summary>
          {w.workLog.length === 0 ? (
            <p className="mt-1 text-muted">Sessions you end with “End session” appear here.</p>
          ) : (
            <ul className="mt-1 space-y-2">
              {w.workLog.map((e) => (
                <li key={e.id}>
                  <span className="t-num block text-[11px] text-muted">
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
      <StageBar w={w} tally={tally} />
      <PickUp
        key={`${w.nextMove}|${w.blocker}`}
        w={w}
        url={url}
        tops={tops.map((t) => t.name)}
        canContribute={canContribute}
        busy={busy}
        call={call}
      />
      <TemplateReview key={w.template?.version ?? 0} w={w} url={url} canEdit={canEdit} busy={busy} call={call} />
      {review}
      {error && <p className="t-body mb-4 text-rust">{error}</p>}
      <div className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-3">{stagesColumn}</div>
        <div className="min-w-0 lg:col-span-4">{criteriaColumn}</div>
        <div className="min-w-0 lg:col-span-5">{cardsColumn}</div>
      </div>
    </>
  );
}

/** One segment per stage, filled by the share of its criteria met; the current one outlined (W-24). */
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
            <span key={s.key} className={`relative block h-2.5 overflow-hidden rounded-sm bg-line ${s.key === w.stage ? 'ring-1 ring-ink' : ''}`}>
              <span className={`absolute inset-y-0 left-0 ${share >= 1 ? 'bg-ink' : 'bg-ink/40'}`} style={{ width: `${Math.round(share * 100)}%` }} />
            </span>
          );
        })}
      </div>
      <div className="mt-1 grid gap-1 font-mono text-[10px] uppercase tracking-wide" style={columns}>
        {w.stages.map((s) => (
          <span key={s.key} className={`min-w-0 truncate ${s.key === w.stage ? 'font-medium text-ink' : 'text-muted'}`}>
            {s.label}
          </span>
        ))}
      </div>
      <p className="t-num mt-1 text-[11px] text-muted">
        {w.finishedAt
          ? `Finished · ${met} of ${total} criteria met`
          : `Stage ${pos} of ${w.stages.length} · ${cur?.label ?? ''}${cur?.standard ? `: ${cur.standard}` : ''} · ${met} of ${total} criteria met`}
      </p>
    </section>
  );
}

/** The re-entry note and ending a session (W-19, W-20). */
function PickUp({
  w,
  url,
  tops,
  canContribute,
  busy,
  call,
}: {
  w: Workflow;
  url: string;
  tops: string[];
  canContribute: boolean;
  busy: boolean;
  call: Call;
}) {
  const [next, setNext] = useState(w.nextMove);
  const [blocker, setBlocker] = useState(w.blocker);
  const [ending, setEnding] = useState(false);
  const [did, setDid] = useState('');
  const [after, setAfter] = useState('');
  const [lines, setLines] = useState('');
  const last = w.workLog[0];
  const sessions = w.blocker ? w.sessionsSinceBlocker : 0;

  return (
    <section aria-label="Pick up here" className="t-body mb-6 rounded border border-ink p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="t-label">Pick up here</p>
        <p className="t-num text-[11px] text-muted">{last ? `Last session ${formatWhen(last.loggedAt)} · ${last.loggedByName}` : 'No session ended yet'}</p>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-9">
          <label className="block">
            <span className="text-[11px] text-muted">Next move: one action you could start within five minutes of opening the set</span>
            {canContribute ? (
              <textarea
                value={next}
                onChange={(e) => setNext(e.target.value)}
                onBlur={() => next.trim() !== w.nextMove && void call(url, 'POST', { op: 'next', next })}
                rows={2}
                placeholder="Resample the reese into a one-bar loop and chop a call phrase"
                className={`${FIELD} mt-1 block w-full text-[17px] font-medium`}
              />
            ) : (
              <span className="mt-1 block text-[17px] font-medium">{w.nextMove || 'None set.'}</span>
            )}
          </label>
          <label className="block">
            <span className="text-[11px] text-muted">
              Blocker{sessions > 0 ? ` · ${sessions} ${sessions === 1 ? 'session' : 'sessions'} now` : ''}
            </span>
            {canContribute ? (
              <input
                value={blocker}
                onChange={(e) => setBlocker(e.target.value)}
                onBlur={() => blocker.trim() !== w.blocker && void call(url, 'POST', { op: 'next', blocker })}
                placeholder="What keeps stopping you?"
                className={`${FIELD} mt-1 block w-full`}
              />
            ) : (
              <span className="mt-1 block">{w.blocker || 'None.'}</span>
            )}
          </label>
          {sessions >= 2 && (
            <p className="text-[12px] text-muted">
              This blocker has lasted {sessions} sessions. Try another way in: bounce the part to audio, pull a reference, send it to a
              collaborator, or leave it for a later stage.
            </p>
          )}
        </div>
        {canContribute && (
          <div className="flex flex-col items-start gap-2 lg:col-span-3">
            {w.nextMove && (
              <button onClick={() => call(url, 'POST', { op: 'pull-next' })} disabled={busy} className={BUTTON}>
                Done · pull the next card up
              </button>
            )}
            <button
              onClick={() => {
                setAfter(w.nextMove);
                setEnding(true);
              }}
              disabled={busy || ending}
              className={BUTTON_PRIMARY}
            >
              End session…
            </button>
            <p className="text-[11px] text-muted">Ending a session logs what you did, sets the next move and turns loose lines into cards.</p>
          </div>
        )}
      </div>
      {ending && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call(url, 'POST', { op: 'end-session', did, next: after, lines: lines.split('\n') })) setEnding(false);
          }}
          className="mt-4 space-y-3 rounded border border-line bg-card p-3"
        >
          <label className="block">
            <span className="text-[11px] text-muted">What did you get done?</span>
            <textarea value={did} onChange={(e) => setDid(e.target.value)} rows={2} className={`${FIELD} mt-1 block w-full`} autoFocus />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted">Next move for next time</span>
            <textarea value={after} onChange={(e) => setAfter(e.target.value)} rows={2} className={`${FIELD} mt-1 block w-full`} />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted">
              Loose thoughts, one per line; each becomes a card. A #tag names the part (#bass, #hats) or parks it for a later stage
              (#mixdown); after “--”, how you will know it is done.
            </span>
            <textarea
              value={lines}
              onChange={(e) => setLines(e.target.value)}
              rows={4}
              placeholder={'Snare too loud against the hats in drop 1 #tactus #mixdown\nReverb throw on the last snare before drop 2 #bus -- the throw lands on the downbeat'}
              className={`${FIELD} mt-1 block w-full font-mono text-[12px]`}
            />
          </label>
          {tops.length > 0 && <p className="text-[11px] text-muted">Parts: {tops.join(', ')}, and the parts under them.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setEnding(false)} className={BUTTON}>
              Cancel
            </button>
            <button type="submit" disabled={busy || (!did.trim() && !after.trim())} className={BUTTON_PRIMARY}>
              Save session
            </button>
          </div>
        </form>
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
                  <span className="block text-[11px] text-muted">
                    {c.change === 'new' ? 'New' : 'Changed'} · {c.stageLabel}
                  </span>
                  <span className="block">{c.body}</span>
                  {c.was && c.was.body !== c.body && <span className="block text-[12px] text-muted line-through">{c.was.body}</span>}
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
              <span className="text-[11px] text-muted">A changed criterion keeps whether it is met. Dismissed ones come back only when the template changes again.</span>
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
  if (lines.length <= 1) return <span className="block text-[12px] text-muted">{hint.trim()}</span>;
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
  return <div className="text-[12px] text-muted">{list(root.children)}</div>;
}

function CriterionRow({ c, canEdit, isOwner, busy, call }: { c: ExitCriterion; canEdit: boolean; isOwner: boolean; busy: boolean; call: Call }) {
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
        {c.metAt && (
          <span className="block text-[11px] text-muted">
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
      <p className="text-[11px] text-muted">
        {c.doneWhen === DONE_WHEN_UNWRITTEN ? <span className="italic">Done when: not written yet{changeable ? ' · Edit to add it' : ''}</span> : `Done when: ${c.doneWhen}`}
      </p>
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

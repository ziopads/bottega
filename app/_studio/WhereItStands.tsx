'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { Section } from '@/app/_ui/layout';
import { BUTTON, BUTTON_PRIMARY, FIELD, TEXT_LINK } from '@/app/_ui/styles';
import type { WorkSession } from '@/lib/sessionTypes';
import { DONE_WHEN_UNWRITTEN } from '@/lib/workflowInput';
import type { Workflow } from '@/lib/workflowTypes';
import { cardElementColor } from '@/lib/elementColors';

// Where it stands (REQUIREMENTS W-39, plan of 25 October): the first section of
// the Overview tab's main column, above the current mix, for getting back in
// after weeks away or deciding to move on. The stage and how far it has come,
// how long since it was worked on, the next to-do and the stage's other open
// ones, the criteria still unmet, and what changed the last time.
// Text sizes: t-lead for the next to-do, t-body, t-small, t-label; nothing else.

type Props = {
  projectId: number;
  workflow: Workflow;
  setWorkflow: (w: Workflow) => void;
  sessions: WorkSession[];
  /** When the current mix was uploaded, counted as work on the project. */
  mixUploadedAt: string | null;
  canContribute: boolean;
  onTab: (tab: string) => void;
};

const COLD_DAYS = 21;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Opens the working panel in a narrow window of its own, to sit beside Live. */
export function openWorkPanel(projectId: number) {
  const w = window.open(`/projects/${projectId}/work`, `bottega-work-${projectId}`, 'popup,width=480,height=920');
  if (!w) window.open(`/projects/${projectId}/work`, '_blank');
}

export default function WhereItStands({ projectId, workflow: w, setWorkflow, sessions, mixUploadedAt, canContribute, onTab }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState('');
  // The page opened at this moment: days since are counted from it.
  const [openedAt] = useState(() => Date.now());

  async function call(url: string, method: string, body?: unknown): Promise<Workflow | null> {
    setError('');
    setBusy(true);
    const r = await api<{ workflow: Workflow }>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body?.error || 'That did not go through.');
      return null;
    }
    setWorkflow(r.data.workflow);
    return r.data.workflow;
  }

  const url = `/api/projects/${projectId}/workflow`;
  const stage = w.stages.find((s) => s.key === w.stage) ?? null;
  const open = w.cards.filter((c) => c.stage === w.stage && !c.settled && (c.status === 'accepted' || c.status === 'in progress'));
  const next = w.cards.find((c) => c.isNext) ?? null;
  const others = open.filter((c) => !c.isNext);
  const criteria = w.criteria.filter((c) => c.stage === w.stage && c.reviewed && !c.rejected);
  const unmet = criteria.filter((c) => !c.metAt);
  const counted = w.cards.filter((c) => c.stage === w.stage && !c.settled && (c.status === 'accepted' || c.status === 'in progress' || c.status === 'done'));
  const total = criteria.length + counted.length;
  const done = criteria.length - unmet.length + counted.filter((c) => c.status === 'done').length;
  const proposals = w.cards.filter((c) => c.status === 'proposed').length + w.criteria.filter((c) => !c.reviewed).length;
  const last = sessions[0] ?? null;
  const dot = (elementId: number | null) => cardElementColor(w.elements, elementId);

  // The last thing done: a session of saves, a to-do changed, a stage moved, a mix uploaded.
  const touched = [last?.end, ...w.cards.map((c) => c.updatedAt), w.moves[0]?.movedAt, mixUploadedAt].filter((x): x is string => !!x).sort().pop() ?? null;
  // Never below zero: a clock a little ahead on the server would give "-1 days".
  const days = touched ? Math.max(0, Math.floor((openedAt - Date.parse(touched)) / 86_400_000)) : null;
  const since =
    days === null ? 'Not worked on yet' : days === 0 ? 'Worked on today' : days === 1 ? 'Last worked on yesterday' : `Last worked on ${days} days ago`;

  async function writeNext(e: React.FormEvent) {
    e.preventDefault();
    const what = writing.trim();
    if (!what || !w.stage) return;
    const after = await call(`/api/projects/${projectId}/cards`, 'POST', { stage: w.stage, what, doneWhen: DONE_WHEN_UNWRITTEN });
    const made = after?.cards.filter((c) => c.what === what && c.stage === w.stage).sort((a, b) => b.id - a.id)[0];
    if (made && (await call(url, 'POST', { op: 'next-card', cardId: made.id }))) setWriting('');
  }

  const action = (
    <button type="button" onClick={() => openWorkPanel(projectId)} className={TEXT_LINK} title="Opens a narrow window to keep beside Live">
      Working session ↗
    </button>
  );

  if (!w.stage || !stage) {
    return (
      <Section label="Where it stands" action={action}>
        <p className="t-body text-muted">
          The workflow has not been started.{' '}
          <button type="button" onClick={() => onTab('workflow')} className={TEXT_LINK}>
            Start it
          </button>
        </p>
      </Section>
    );
  }

  return (
    <Section label={`Where it stands · ${stage.label}`} action={action}>
      <div className="t-body space-y-3">
        <p className="t-small text-muted">
          <button type="button" onClick={() => onTab('workflow')} className={TEXT_LINK}>
            Stage {stage.position} of {w.stages.length}
          </button>
          <span className="t-num">
            {' · '}
            {total === 0 ? 'nothing written yet' : `${done} of ${total} done`}
            {' · '}
          </span>
          <span className={days === null ? '' : days >= COLD_DAYS ? 'font-medium text-cold' : days >= 7 ? 'text-cooling' : 'text-fresh'}>{since}</span>
          {proposals > 0 && <span className="t-num">{` · ${proposals} proposed by Claude`}</span>}
        </p>

        <div>
          <p className="t-small text-muted">Next</p>
          {next ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <div className="min-w-0 flex-1">
                <p className="t-lead flex items-baseline gap-2 font-medium">
                  <span aria-hidden className="h-2 w-2 shrink-0 translate-y-[-2px] rounded-full" style={{ background: dot(next.elementId) }} />
                  {next.what}
                </p>
                {next.doneWhen && next.doneWhen !== DONE_WHEN_UNWRITTEN && <p className="t-small text-muted">Done when {next.doneWhen}</p>}
              </div>
              {canContribute && (
                <span className="flex gap-1.5">
                  {next.status === 'accepted' && (
                    <button type="button" onClick={() => call(`/api/cards/${next.id}`, 'PATCH', { status: 'in progress' })} disabled={busy} className={BUTTON}>
                      Start
                    </button>
                  )}
                  <button type="button" onClick={() => call(`/api/cards/${next.id}`, 'PATCH', { status: 'done' })} disabled={busy} className={BUTTON_PRIMARY}>
                    Done
                  </button>
                </span>
              )}
            </div>
          ) : canContribute ? (
            <form onSubmit={writeNext} className="mt-1 flex gap-2">
              <input
                value={writing}
                onChange={(e) => setWriting(e.target.value)}
                placeholder="Something to start within five minutes of opening the set"
                className={`${FIELD} min-w-0 flex-1`}
              />
              <button type="submit" disabled={busy || !writing.trim()} className={BUTTON}>
                Make it next
              </button>
            </form>
          ) : (
            <p className="text-muted">No to-do marked next.</p>
          )}
        </div>

        {others.length > 0 && (
          <div>
            <p className="t-small text-muted">Also open · {others.length}</p>
            <ul className="mt-0.5 space-y-1">
              {others.slice(0, 3).map((c) => (
                <li key={c.id} className="flex items-baseline gap-2">
                  <span aria-hidden className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: dot(c.elementId) }} />
                  <span className="min-w-0 flex-1">
                    {c.what}
                    {c.status === 'in progress' && <span className="t-small text-muted"> · in progress</span>}
                  </span>
                  {canContribute && (
                    <button type="button" onClick={() => call(url, 'POST', { op: 'next-card', cardId: c.id })} disabled={busy} className={BUTTON}>
                      Make next
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {others.length > 3 && (
              <button type="button" onClick={() => onTab('workflow')} className={`t-small mt-1 ${TEXT_LINK}`}>
                All {others.length} on the Workflow tab
              </button>
            )}
          </div>
        )}

        {unmet.length > 0 && (
          <div>
            <p className="t-small text-muted">Still to meet</p>
            <ul className="mt-0.5 space-y-0.5 text-muted">
              {unmet.slice(0, 3).map((c) => (
                <li key={c.id}>☐ {c.body}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="t-small text-live">Last time · read from the saved sets</p>
          {last ? (
            <>
              <p>
                {day(last.start)}, {clockTime(last.start)}
                {last.saves > 1 ? `–${clockTime(last.end)}` : ''} · {last.saves} {last.saves === 1 ? 'save' : 'saves'}
                {last.variant ? ` · ${last.variant}` : ''}
              </p>
              {last.first ? (
                <p className="text-muted">The first set Bottega read.</p>
              ) : last.changes === null ? null : last.changes.length === 0 ? (
                <p className="text-muted">Nothing the set reader tracks changed.</p>
              ) : (
                <ul className="list-disc pl-4 text-muted">
                  {last.changes.slice(0, 4).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-muted">No saved sets read yet. The watcher sends them as Live saves.</p>
          )}
        </div>

        {error && <p className="text-rust">{error}</p>}
      </div>
    </Section>
  );
}

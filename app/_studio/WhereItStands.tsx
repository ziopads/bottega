'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { toggle as deckToggle, useDeck, type PlayItem } from '@/app/_ui/audio/deck';
import { BUTTON, BUTTON_PRIMARY, FIELD, TEXT_LINK } from '@/app/_ui/styles';
import type { WorkSession } from '@/lib/sessionTypes';
import type { StudioTrack } from '@/lib/studioTypes';
import { DONE_WHEN_UNWRITTEN } from '@/lib/workflowInput';
import type { Workflow, WorkflowCard } from '@/lib/workflowTypes';

// Where it stands (REQUIREMENTS W-39, plan of 25 October): the top of every
// tab of a project, for getting back in after weeks away or deciding to move
// on. Left: the stage and how far it has come, the next to-do (done, another,
// or a new one), and the stage's other open to-dos. Right: how long since it
// was worked on, the last session read from the saved sets, the current mix
// to play, and the working panel to open beside Live.

type Props = {
  projectId: number;
  code: string;
  title: string;
  workflow: Workflow;
  setWorkflow: (w: Workflow) => void;
  sessions: WorkSession[];
  current: StudioTrack | null;
  canContribute: boolean;
  onTab: (tab: string) => void;
};

const COLD_DAYS = 21;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Opens the working panel in a narrow window of its own, to sit beside Live;
 * where pop-ups are blocked, in a tab.
 */
export function openWorkPanel(projectId: number) {
  const w = window.open(`/projects/${projectId}/work`, `bottega-work-${projectId}`, 'popup,width=480,height=920');
  if (!w) window.open(`/projects/${projectId}/work`, '_blank');
}

export default function WhereItStands({ projectId, code, title, workflow: w, setWorkflow, sessions, current, canContribute, onTab }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState('');
  const deck = useDeck();
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
  const met = criteria.filter((c) => c.metAt).length;
  const last = sessions[0] ?? null;

  // The last thing done: a session of saves, a to-do changed, a stage moved, a mix uploaded.
  const touched = [last?.end, ...w.cards.map((c) => c.updatedAt), w.moves[0]?.movedAt, current?.uploadedAt].filter((x): x is string => !!x).sort().pop() ?? null;
  const days = touched ? Math.floor((openedAt - Date.parse(touched)) / 86_400_000) : null;
  const playing = !!current && deck.item?.trackId === current.id && deck.playing;
  const item: PlayItem | null = current
    ? { trackId: current.id, projectId, code, title, label: current.label, kind: 'mix', variant: current.variant, durationS: current.durationS }
    : null;

  async function writeNext(e: React.FormEvent) {
    e.preventDefault();
    const what = writing.trim();
    if (!what || !w.stage) return;
    const after = await call(`/api/projects/${projectId}/cards`, 'POST', { stage: w.stage, what, doneWhen: DONE_WHEN_UNWRITTEN });
    const made = after?.cards.filter((c) => c.what === what && c.stage === w.stage).sort((a, b) => b.id - a.id)[0];
    if (made && (await call(url, 'POST', { op: 'next-card', cardId: made.id }))) setWriting('');
  }

  if (!w.stage) {
    return (
      <section aria-label="Where it stands" className="t-body mb-4 flex flex-wrap items-center gap-3 rounded-md border border-line px-4 py-2.5">
        <span className="text-muted">The workflow has not been started, so Bottega can&rsquo;t yet say where this project stands.</span>
        <button type="button" onClick={() => onTab('workflow')} className={BUTTON}>
          Start it on the Workflow tab
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Where it stands" className="t-body mb-4 rounded-md border border-ink p-4">
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <div className="min-w-0 flex-[999_1_480px] space-y-3">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="t-label">Where it stands</span>
            <button type="button" onClick={() => onTab('workflow')} className="text-left font-medium hover:text-rust">
              Stage {stage?.position} of {w.stages.length} · {stage?.label}
              {stage?.standard ? `: ${stage.standard}` : ''}
            </button>
            <span className="t-num text-[12px] text-muted">
              {met} of {criteria.length} criteria met
            </span>
          </p>

          <div>
            <p className="text-[11px] text-muted">Next</p>
            {next ? (
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <p className="min-w-0 flex-1 text-[18px] font-medium leading-snug">
                  {next.what}
                  {next.doneWhen && next.doneWhen !== DONE_WHEN_UNWRITTEN && (
                    <span className="mt-0.5 block text-[12px] font-normal text-muted">Done when: {next.doneWhen}</span>
                  )}
                </p>
                {canContribute && (
                  <span className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => call(`/api/cards/${next.id}`, 'PATCH', { status: 'done' })} disabled={busy} className={BUTTON_PRIMARY}>
                      Done · next one up
                    </button>
                    {next.status === 'accepted' && (
                      <button type="button" onClick={() => call(`/api/cards/${next.id}`, 'PATCH', { status: 'in progress' })} disabled={busy} className={BUTTON}>
                        Start
                      </button>
                    )}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-[15px] text-muted">No to-do marked next.</p>
            )}
            {canContribute && !next && (
              <form onSubmit={writeNext} className="mt-1.5 flex gap-2">
                <input
                  value={writing}
                  onChange={(e) => setWriting(e.target.value)}
                  placeholder="Something you could start within five minutes of opening the set"
                  className={`${FIELD} min-w-0 flex-1`}
                />
                <button type="submit" disabled={busy || !writing.trim()} className={BUTTON}>
                  Make it next
                </button>
              </form>
            )}
          </div>

          {others.length > 0 && (
            <div>
              <p className="text-[11px] text-muted">
                Also open in {stage?.label} · {others.length}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {others.slice(0, 3).map((c: WorkflowCard) => (
                  <li key={c.id} className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1">
                      {c.status === 'in progress' && <span className="mr-1 font-mono text-[10px] text-muted">in progress</span>}
                      {c.what}
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
                <button type="button" onClick={() => onTab('workflow')} className={`mt-1 text-[12px] ${TEXT_LINK}`}>
                  All {others.length} on the Workflow tab
                </button>
              )}
            </div>
          )}
          {error && <p className="text-rust">{error}</p>}
        </div>

        <div className="min-w-0 flex-[1_1_280px] space-y-3 border-line lg:border-l lg:pl-6">
          <p className={days !== null && days >= COLD_DAYS ? 'font-medium text-rust' : 'text-muted'}>
            {days === null ? 'Not worked on yet.' : days === 0 ? 'Worked on today.' : days === 1 ? 'Last worked on yesterday.' : `Last worked on ${days} days ago.`}
          </p>
          <div>
            <p className="text-[11px] text-muted">Last time</p>
            {last ? (
              <>
                <p>
                  {day(last.start)}, {clockTime(last.start)}
                  {last.saves > 1 ? `–${clockTime(last.end)}` : ''} · {last.saves} {last.saves === 1 ? 'save' : 'saves'}
                  {last.variant ? ` · ${last.variant}` : ''}
                </p>
                {last.first ? (
                  <p className="text-[12px] text-muted">The first set Bottega read.</p>
                ) : last.changes === null ? null : last.changes.length === 0 ? (
                  <p className="text-[12px] text-muted">Nothing the set reader tracks changed.</p>
                ) : (
                  <ul className="mt-0.5 list-disc pl-4 text-[12px] text-muted">
                    {last.changes.slice(0, 6).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-[12px] text-muted">No saved sets read yet. The watcher sends them as Live saves.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {item && (
              <button type="button" onClick={() => deckToggle(item)} className={BUTTON}>
                {playing ? '❚❚ Pause' : `▶ Play ${current?.label}`}
              </button>
            )}
            <button type="button" onClick={() => openWorkPanel(projectId)} className={BUTTON_PRIMARY} title="Opens a narrow window to keep beside Live">
              Working session ↗
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

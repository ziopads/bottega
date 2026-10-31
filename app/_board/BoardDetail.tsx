'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { mixMarkers } from '@/app/_studio/Notes';
import { openWorkPanel } from '@/app/_studio/WhereItStands';
import Player from '@/app/_ui/audio/Player';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY, FIELD } from '@/app/_ui/styles';
import type { SessionState } from '@/lib/als/store';
import { keyLabel } from '@/lib/als/types';
import type { BoardProject } from '@/lib/boardTypes';
import type { WorkSession } from '@/lib/sessionTypes';
import type { StudioTrack } from '@/lib/studioTypes';
import { formatDuration } from '@/lib/studioTypes';
import { DONE_WHEN_UNWRITTEN } from '@/lib/workflowInput';
import type { Workflow, WorkflowCard } from '@/lib/workflowTypes';

// The board's right-hand side: the project chosen in the rotation rack, laid
// out like the channel strip of the Finish Line prototype (25 October):
//
//   the track     name, BPM, key, genre, stars, started; the stage meter
//   pick up here  last worked on, the next to-do, on deck, adding a to-do
//   stages        one tab per stage: its criteria (tick them here, with the
//                 marks read from the set) and its to-dos (check them off here)
//   current mix   the player, to-dos pinned to moments on the waveform
//   from Live     the newest saved set: tempo, key, length, tracks, master
//                 chain, and the arrangement by its locators
//   sessions and learnings
//
// Loaded when the project is chosen; every change goes through the same
// routes as the project page, and the rack refreshes after each.

type Loaded = {
  id: number;
  workflow: Workflow;
  sessions: WorkSession[];
  mix: StudioTrack | null;
  state: SessionState | null;
};

const CARD = 'rounded-[var(--radius)] border border-line bg-panel p-4';
const OPEN = (c: WorkflowCard) => !c.settled && (c.status === 'accepted' || c.status === 'in progress');

function daysSince(iso: string | null, now: number): number | null {
  return iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000)) : null;
}
function ago(d: number | null): string {
  return d === null ? 'not yet' : d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function BoardDetail({
  project,
  coldDays,
  busy,
  onBack,
  onChanged,
}: {
  project: BoardProject;
  coldDays: number;
  busy: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    const id = project.id;
    Promise.all([
      api<{ workflow: Workflow }>(`/api/projects/${id}/workflow`, { method: 'GET' }),
      api<{ sessions: WorkSession[] }>(`/api/projects/${id}/sessions`, { method: 'GET' }),
      api<{ tracks: StudioTrack[] }>(`/api/projects/${id}/tracks`, { method: 'GET' }),
      api<{ state: SessionState }>(`/api/projects/${id}/als?state=1`, { method: 'GET' }),
    ]).then(([w, s, t, a]) => {
      if (!live) return;
      if (!w.ok) {
        setError(w.body?.error || 'Could not load this project.');
        return;
      }
      setError('');
      const tracks = t.ok ? t.data.tracks : [];
      setData({
        id,
        workflow: w.data.workflow,
        sessions: s.ok ? s.data.sessions : [],
        mix: tracks.find((x) => x.id === project.latest?.trackId) ?? null,
        state: a.ok ? a.data.state : null,
      });
    });
    return () => {
      live = false;
    };
  }, [project.id, project.latest?.trackId]);

  const shown = data && data.id === project.id ? data : null;

  async function call(url: string, method: string, body?: unknown): Promise<Workflow | null> {
    if (!shown) return null;
    setError('');
    setWorking(true);
    const r = await api<{ workflow: Workflow }>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    setWorking(false);
    if (!r.ok) {
      setError(r.body?.error || 'That did not go through.');
      return null;
    }
    setData({ ...shown, workflow: r.data.workflow });
    onChanged();
    return r.data.workflow;
  }

  return (
    <div className="t-body min-w-0 space-y-4">
      <Header project={project} workflow={shown?.workflow ?? null} busy={busy} onBack={onBack} />
      {error && <p className="text-rust">{error}</p>}
      {!shown && !error && <p className="text-muted">Loading…</p>}
      {shown && (
        <>
          <PickUp project={project} d={shown} coldDays={coldDays} openedAt={openedAt} busy={working} call={call} />
          <Stages project={project} w={shown.workflow} busy={working} call={call} />
          <Mix project={project} d={shown} />
          <FromLive state={shown.state} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Sessions sessions={shown.sessions} />
            <Learnings w={shown.workflow} />
          </div>
          <p className="flex flex-wrap items-baseline justify-between gap-2 t-small text-muted">
            <span className="t-num">Started {day(project.startedAt)}</span>
            <Link href={`/projects/${project.id}`} className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
              Everything else on the project page →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

// ── The track ────────────────────────────────────────────────────────────────

function Header({ project, workflow, busy, onBack }: { project: BoardProject; workflow: Workflow | null; busy: boolean; onBack: () => void }) {
  const cur = project.stages.findIndex((s) => s.key === project.stage);
  const stage = workflow?.stages.find((s) => s.key === project.stage) ?? null;
  const met = project.stages.reduce((n, s) => n + s.met, 0);
  const total = project.stages.reduce((n, s) => n + s.total, 0);
  const facts: [string, string][] = [
    ['BPM', project.bpm ? String(project.bpm) : '—'],
    ['Key', project.key ?? '—'],
    ['Genre', project.genre || '—'],
    ['Stars', project.rating ? '★'.repeat(project.rating) : '—'],
    ['Mix', project.latest ? `${project.latest.label}${project.latest.durationS ? ` · ${formatDuration(project.latest.durationS)}` : ''}` : '—'],
  ];
  return (
    <section className={`${CARD} space-y-3`}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="t-label">
            {project.code}
            {project.ownerName ? ` · ${project.ownerName}` : ''}
          </p>
          <h2 className="t-title">
            <Link href={`/projects/${project.id}`} className="hover:text-rust">
              {project.title}
            </Link>
          </h2>
        </div>
        <span className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => openWorkPanel(project.id)} className={BUTTON_PRIMARY} title="Opens a narrow window to keep beside Live">
            Working session ↗
          </button>
          <Link href={`/projects/${project.id}`} className={BUTTON}>
            Open project
          </Link>
          <button type="button" onClick={onBack} disabled={busy} className={BUTTON} title="Back to the backlog">
            ↓ Backlog
          </button>
        </span>
      </div>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-[var(--radius)] bg-card px-2.5 py-1.5">
            <dt className="t-label">{k}</dt>
            <dd className="t-num truncate" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {project.stages.length > 0 ? (
        <div>
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${project.stages.length}, minmax(0, 1fr))` }} role="img" aria-label={stage ? `At ${stage.label}` : ''}>
            {project.stages.map((s, i) => {
              const share = s.total ? s.met / s.total : i < cur ? 1 : 0;
              return (
                <span key={s.key} className={`relative block h-2.5 overflow-hidden rounded-[2px] bg-led-off ${i === cur ? 'ring-1 ring-meter-now' : ''}`}>
                  <span className={`absolute inset-y-0 left-0 ${share >= 1 ? 'bg-meter-done' : 'bg-meter-now'}`} style={{ width: `${Math.round(share * 100)}%` }} />
                </span>
              );
            })}
          </div>
          <div className="mt-1 grid gap-[3px] t-small text-muted" style={{ gridTemplateColumns: `repeat(${project.stages.length}, minmax(0, 1fr))` }}>
            {project.stages.map((s, i) => (
              <span key={s.key} className={`min-w-0 truncate ${i === cur ? 'font-medium text-ink' : ''}`}>
                {s.label}
              </span>
            ))}
          </div>
          <p className="mt-2 t-num t-small text-muted">
            {cur >= 0 ? `Stage ${cur + 1} of ${project.stages.length} · ${project.stages[cur].label}` : 'Not started'}
            {stage?.standard ? `: ${stage.standard}` : ''} · {met}/{total} criteria
          </p>
        </div>
      ) : (
        <p className="text-muted">The workflow has not been started.</p>
      )}
    </section>
  );
}

// ── Pick up here ─────────────────────────────────────────────────────────────

type Call = (url: string, method: string, body?: unknown) => Promise<Workflow | null>;

function PickUp({ project, d, coldDays, openedAt, busy, call }: { project: BoardProject; d: Loaded; coldDays: number; openedAt: number; busy: boolean; call: Call }) {
  const w = d.workflow;
  const [what, setWhat] = useState('');
  const [stageKey, setStageKey] = useState('');
  const can = project.canContribute;
  const pos = w.stages.find((s) => s.key === w.stage)?.position ?? 0;
  const positionOf = (key: string) => w.stages.find((s) => s.key === key)?.position ?? 0;
  const next = w.cards.find((c) => c.isNext) ?? null;
  const now = w.cards.filter((c) => OPEN(c) && c.stage === w.stage && !c.isNext);
  const later = w.cards.filter((c) => OPEN(c) && positionOf(c.stage) > pos);
  // The stage follows the exit criteria, so with no to-do left in it an unmet criterion is what to pick up.
  const openCriterion = w.criteria.filter((c) => c.stage === w.stage && c.reviewed && !c.rejected && !c.metAt).sort((a, b) => a.position - b.position)[0] ?? null;
  const days = daysSince(project.touchedAt, openedAt);
  const url = `/api/projects/${project.id}/workflow`;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const text = what.trim();
    if (!text || !w.stage) return;
    if (await call(`/api/projects/${project.id}/cards`, 'POST', { stage: stageKey || w.stage, what: text, doneWhen: DONE_WHEN_UNWRITTEN })) setWhat('');
  }

  return (
    <section className={`${CARD} space-y-3 border-rust`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="t-section">Pick up here</h3>
        <span className={`t-small ${days === null ? 'text-muted' : days >= coldDays ? 'font-medium text-cold' : days >= 7 ? 'text-cooling' : 'text-fresh'}`}>Last worked on {ago(days)}</span>
      </div>
      {!w.stage ? (
        <p className="text-muted">
          Start the workflow on the{' '}
          <Link href={`/projects/${project.id}?tab=workflow`} className="underline decoration-ink/30 underline-offset-2">
            Workflow tab
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="pb-2">
            <p className="mb-2 t-small text-muted">Next · something to start within five minutes of opening the set</p>
            {next ? (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                <p className="t-lead min-w-0 flex-1 font-medium">
                  {next.what}
                </p>
                {can && (
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => call(`/api/cards/${next.id}`, 'PATCH', { status: 'done' })} disabled={busy} className={BUTTON_PRIMARY} title="Mark it done; the next open to-do of the stage takes its place">
                      Done · pull next
                    </button>
                  </span>
                )}
              </div>
            ) : (
              <p className="text-muted">
                {openCriterion && now.length === 0 ? (
                  <>
                    No to-do in {w.stages.find((s) => s.key === w.stage)?.label}. Still to meet: <span className="font-medium text-ink">{openCriterion.body}</span>
                  </>
                ) : (
                  'No to-do marked next. Make one next below, or add one.'
                )}
              </p>
            )}
          </div>

          <div>
            <p className="flex justify-between gap-2 t-label">
              <span>On deck</span>
              <span>
                {now.length} now{later.length ? ` · ${later.length} later` : ''}
              </span>
            </p>
            {now.length === 0 ? (
              <p className="mt-1 text-muted">Nothing else on deck for this stage.</p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {now.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-1.5">
                    {can ? (
                      <input type="checkbox" checked={false} onChange={() => call(`/api/cards/${c.id}`, 'PATCH', { status: 'done' })} disabled={busy} aria-label={`Done: ${c.what}`} className="accent-[var(--accent)]" />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      {c.what}
                      {c.status === 'in progress' && <span className="t-small text-muted"> · in progress</span>}
                    </span>
                    {can && (
                      <button type="button" onClick={() => call(url, 'POST', { op: 'next-card', cardId: c.id })} disabled={busy} className={BUTTON}>
                        ↑ Next
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {later.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer t-small text-muted">{later.length} for later stages</summary>
                <ul className="mt-1 space-y-0.5">
                  {later.map((c) => (
                    <li key={c.id} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1">{c.what}</span>
                      <span className="t-label">{w.stages.find((s) => s.key === c.stage)?.label}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {can && (
            <form onSubmit={add} className="flex flex-wrap gap-2">
              <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Add a to-do, such as: the click at bar 48 on the riser" aria-label="New to-do" className={`${FIELD} min-w-0 flex-[1_1_16rem]`} />
              <select value={stageKey || w.stage} onChange={(e) => setStageKey(e.target.value)} aria-label="Stage" className={FIELD}>
                {w.stages.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={busy || !what.trim()} className={BUTTON}>
                Add
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

// ── The current mix ──────────────────────────────────────────────────────────

function Mix({ project, d }: { project: BoardProject; d: Loaded }) {
  const m = d.mix;
  return (
    <section className={`${CARD} space-y-2`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="t-section">{m ? `Current mix · ${m.label}` : 'Current mix'}</h3>
        {project.latest && project.latest.count > 1 && (
          <Link href={`/projects/${project.id}?tab=mixes`} className="t-small text-muted underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
            All {project.latest.count} versions →
          </Link>
        )}
      </div>
      {m ? (
        <Player
          item={{ trackId: m.id, projectId: project.id, code: project.code, title: project.title, label: m.label, kind: 'mix', variant: m.variant, durationS: m.durationS }}
          peaks={m.peaks}
          durationS={m.durationS}
          markers={mixMarkers([], d.workflow.cards, m.id, d.workflow.elements)}
          height={56}
        />
      ) : (
        <p className="text-muted">
          No mixes yet. Export from Live and add the bounce on the{' '}
          <Link href={`/projects/${project.id}?tab=mixes`} className="underline decoration-ink/30 underline-offset-2">
            Mixes tab
          </Link>
          ; each version is kept.
        </p>
      )}
    </section>
  );
}

// ── Stages ───────────────────────────────────────────────────────────────────

function Stages({ project, w, busy, call }: { project: BoardProject; w: Workflow; busy: boolean; call: Call }) {
  const [tab, setTab] = useState<string | null>(null);
  if (!w.stage) return null;
  const key = tab ?? w.stage;
  const sel = w.stages.find((s) => s.key === key) ?? w.stages[0];
  const crit = (k: string) => w.criteria.filter((c) => c.stage === k && c.reviewed && !c.rejected);
  // The stage's to-dos, done ones too, so that a done one can be reopened; settled decisions and proposals are not to-dos here.
  const todosOf = (k: string) => w.cards.filter((c) => !c.settled && (c.status === 'accepted' || c.status === 'in progress' || c.status === 'done') && c.stage === k);
  const todos = todosOf(sel.key);
  const can = project.canContribute;
  return (
    <section className={`${CARD} space-y-3`}>
      <div role="tablist" aria-label="Stages" className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1">
        {w.stages.map((s) => {
          const cs = crit(s.key);
          const ks = todosOf(s.key);
          const total = cs.length + ks.length;
          const met = cs.filter((c) => c.metAt).length + ks.filter((c) => c.status === 'done').length;
          const critMet = cs.filter((c) => c.metAt).length;
          const on = s.key === sel.key;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(s.key)}
              className={`space-y-1 rounded-[var(--radius)] border px-1.5 py-1.5 text-center ${on ? 'border-rust bg-panel' : 'border-line bg-card hover:border-muted'}`}
            >
              <span className={`block truncate t-small font-medium ${s.key === w.stage ? 'text-rust' : ''}`}>{s.label}</span>
              <span className="block h-1 overflow-hidden rounded bg-led-off">
                <span className={`block h-full ${total && met === total ? 'bg-meter-done' : 'bg-meter-now'}`} style={{ width: `${total ? Math.round((met / total) * 100) : 0}%` }} />
              </span>
              <span className="block t-num t-small text-muted">
                {critMet}/{cs.length}
                {ks.some((c) => c.status !== 'done') ? <span className="text-rust"> +{ks.filter((c) => c.status !== 'done').length}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-muted">
        Stage {sel.position}: <span className="font-medium text-ink">{sel.standard || sel.label}</span>
      </p>
      <ul className="space-y-0.5">
        {crit(sel.key).map((c) => {
          const r = c.checkKey ? w.setReading?.results[c.checkKey] : undefined;
          return (
            <li key={c.id} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-ink/5">
              <input
                type="checkbox"
                id={`bc-${c.id}`}
                checked={!!c.metAt}
                disabled={!can || busy}
                onChange={(e) => call(`/api/criteria/${c.id}`, 'PATCH', { met: e.target.checked })}
                className="mt-1 accent-[var(--accent)]"
              />
              <label htmlFor={`bc-${c.id}`} className="min-w-0 flex-1">
                <span className={c.metAt ? 'text-muted line-through' : 'font-medium'}>{c.body}</span>
                {c.hint.trim() && <span className="block whitespace-pre-wrap t-small text-muted">{c.hint}</span>}
                {r && !c.metAt && r.verdict !== 'unknown' && (
                  <span className={`mt-0.5 inline-block rounded-[3px] border border-dashed px-1.5 t-small ${r.verdict === 'likely' ? 'border-live text-live' : 'border-ink/30 text-muted'}`}>
                    {r.verdict === 'likely' ? 'Live: likely done' : 'Live: not yet'} · {r.reading}
                  </span>
                )}
              </label>
            </li>
          );
        })}
        {crit(sel.key).length === 0 && <li className="text-muted">No criteria written for this stage.</li>}
      </ul>
      {todos.length > 0 && (
        <div>
          <p className="flex justify-between t-label">
            <span>To-dos for {sel.label}</span>
            <span>{todos.filter((c) => c.status !== 'done').length} open</span>
          </p>
          <ul className="mt-1 space-y-0.5">
            {todos.map((c) => (
              <li key={c.id} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-ink/5">
                <input
                  type="checkbox"
                  id={`bt-${c.id}`}
                  checked={c.status === 'done'}
                  disabled={!can || busy}
                  onChange={(e) => call(`/api/cards/${c.id}`, 'PATCH', { status: e.target.checked ? 'done' : 'accepted' })}
                  className="mt-1 accent-[var(--accent)]"
                />
                <label htmlFor={`bt-${c.id}`} className="min-w-0 flex-1">
                  <span className={c.status === 'done' ? 'text-muted line-through' : 'font-medium'}>{c.what}</span>
                </label>
                {c.isNext && c.status !== 'done' && <span className="t-label text-rust">Next</span>}
                {project.isOwner && (
                  <button type="button" onClick={() => confirm('Delete this to-do?') && call(`/api/cards/${c.id}`, 'DELETE')} disabled={busy} className={`${BUTTON_DANGER} self-start`} aria-label={`Delete to-do: ${c.what}`} title="Delete this to-do">
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── From Live ────────────────────────────────────────────────────────────────

function FromLive({ state }: { state: SessionState | null }) {
  const sel = state?.selected ?? null;
  if (!sel) {
    return (
      <section className={`${CARD} border-live`}>
        <h3 className="t-section text-live">From Live</h3>
        <p className="mt-1 text-muted">No saved set read yet. The watcher sends each one as Live saves it, or drop the project folder on the State tab.</p>
      </section>
    );
  }
  const set = sel.set;
  const bars = (beats: number) => Math.round(beats / 4);
  const lenBars = bars(set.lengthBeats);
  const seconds = set.tempo ? Math.round((set.lengthBeats * 60) / set.tempo) : null;
  const tracks = set.tracks.filter((t) => t.kind !== 'main' && t.kind !== 'return');
  const groups = set.tracks.filter((t) => t.kind === 'group').length;
  const master = set.tracks.find((t) => t.kind === 'main')?.devices.map((d) => d.name) ?? [];
  const locs = set.locators.slice().sort((a, b) => a.beat - b.beat);
  const sections = locs.map((l, i) => {
    const end = i < locs.length - 1 ? locs[i + 1].beat : Math.max(set.lengthBeats, l.beat + 16);
    return { name: l.name, bar: bars(l.beat) + 1, length: Math.max(4, end - l.beat) };
  });
  const facts: [string, string][] = [
    ['Tempo', set.tempo ? `${Math.round(set.tempo * 100) / 100} BPM` : '—'],
    ['Key', keyLabel(set.key ?? null) ?? '—'],
    ['Length', lenBars ? `${lenBars} bars${seconds ? ` · ${formatDuration(seconds)}` : ''}` : '—'],
    ['Tracks', `${tracks.length}${groups ? ` · ${groups} groups` : ''}`],
    ['Master', master.length ? master.join(', ') : 'clean'],
  ];
  return (
    <section className={`${CARD} space-y-3 border-live`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="t-section text-live">From Live · {sel.fileName.replace(/\.als$/i, '')}</h3>
        <span className="t-num t-small text-muted">
          Saved {day(sel.savedAt)}, {clock(sel.savedAt)}
        </span>
      </div>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-[var(--radius)] bg-card px-2.5 py-1.5">
            <dt className="t-label">{k}</dt>
            <dd className="t-num truncate" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {sections.length > 0 && (
        <div className="overflow-x-auto">
          <div className="flex h-11 min-w-[30rem] overflow-hidden rounded-[var(--radius)] border border-line" aria-label="The arrangement by its locators">
            {sections.map((x, i) => {
              const drop = /drop/i.test(x.name);
              const brk = /break/i.test(x.name);
              return (
                <div
                  key={i}
                  title={`${x.name} · bar ${x.bar}, ${bars(x.length)} bars`}
                  className={`flex min-w-0 flex-col justify-between border-r border-parchment px-1.5 py-1 last:border-r-0 ${drop ? 'bg-meter-now/20' : brk ? 'bg-live/15' : 'bg-card'}`}
                  style={{ flex: `${x.length} 1 0` }}
                >
                  <span className={`truncate t-small ${drop ? 'font-medium text-rust' : ''}`}>{x.name}</span>
                  <span className="t-num t-small text-muted">{x.bar}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Sessions and learnings ───────────────────────────────────────────────────

function Sessions({ sessions }: { sessions: WorkSession[] }) {
  return (
    <section className={`${CARD} space-y-2`}>
      <h3 className="t-section">Sessions</h3>
      {sessions.length === 0 ? (
        <p className="text-muted">No saved sets read yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {sessions.slice(0, 3).map((s) => (
            <li key={s.start} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
              <span className="t-num t-small text-muted">
                {new Date(s.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                <br />
                {clock(s.start)}
              </span>
              <span>
                {s.saves} {s.saves === 1 ? 'save' : 'saves'}
                {s.variant ? ` · ${s.variant}` : ''}
                {s.first ? (
                  <span className="block t-small text-muted">The first set read.</span>
                ) : s.changes && s.changes.length ? (
                  <span className="block t-small text-muted">{s.changes.slice(0, 3).join(' · ')}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Learnings({ w }: { w: Workflow }) {
  const stage = w.stages.find((s) => s.key === w.stage);
  const list = w.learnings.filter((l) => l.stage === w.stage && l.reviewed);
  return (
    <section className={`${CARD} space-y-2`}>
      <h3 className="t-section">Learnings{stage ? ` · ${stage.label}` : ''}</h3>
      {list.length === 0 ? (
        <p className="text-muted">Nothing written down for this stage yet. Learnings belong to the template and come back on every project at this stage.</p>
      ) : (
        <ul className="list-disc space-y-1 pl-4">
          {list.map((l) => (
            <li key={l.id}>{l.body}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

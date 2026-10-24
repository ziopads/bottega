'use client';

import Link from 'next/link';
import { useMemo, useState, useSyncExternalStore } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON, FIELD, SEGMENT, SEGMENTS, TEXT_LINK } from '@/app/_ui/styles';
import { TODO_COLUMNS, type Todo, type TodoStatus } from '@/lib/todoTypes';

// To-dos (REQUIREMENTS W-35, W-36; plan of 24 October): every card across the
// person's projects in one place, as a board by status or a list.
//
//   Filters    projects (in rotation by default, the whole board, every
//              project, or one), stage (each project's current stage by
//              default, with those parked for later, or any), element, kind
//   Done       shown or hidden, from the last 14 days, 30 days, or ever
//   Board      To do · In progress · Done, optionally one row per project;
//              a card drags between columns, or its button moves it on
//   → Note     moves a card back to its project's notes (db/028)
//
// The view, done and row choices are remembered in this browser.

type ProjectFilter = 'rotation' | 'board' | 'all' | number;
type StageFilter = 'current' | 'parked' | 'any';
type Window = 14 | 30 | 0;
type Prefs = { view: 'board' | 'list'; showDone: boolean; window: Window; byProject: boolean };

const PREFS_KEY = 'bottega.todos';
const DEFAULT_PREFS: Prefs = { view: 'board', showDone: true, window: 14, byProject: true };

const NEXT: Record<TodoStatus, { to: TodoStatus; label: string }> = {
  accepted: { to: 'in progress', label: 'Start' },
  'in progress': { to: 'done', label: 'Done' },
  done: { to: 'accepted', label: 'Reopen' },
};

// The remembered choices, kept in this browser's storage as the volume is
// (app/_ui/audio/volume.ts); a browser that refuses storage keeps them for
// the visit.
let prefsNow: Prefs = DEFAULT_PREFS;
let prefsLoaded = false;
const prefsListeners = new Set<() => void>();

function readPrefs(): Prefs {
  if (prefsLoaded) return prefsNow;
  prefsLoaded = true;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) prefsNow = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // storage unavailable: the defaults hold for this visit
  }
  return prefsNow;
}

function writePrefs(p: Partial<Prefs>) {
  prefsNow = { ...readPrefs(), ...p };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefsNow));
  } catch {
    // as above
  }
  prefsListeners.forEach((l) => l());
}

function subscribePrefs(listener: () => void) {
  prefsListeners.add(listener);
  return () => {
    prefsListeners.delete(listener);
  };
}

export default function TodosView({ initial, project }: { initial: Todo[]; project: number | null }) {
  const [todos, setTodos] = useState(initial);
  const prefs = useSyncExternalStore(subscribePrefs, readPrefs, () => DEFAULT_PREFS);
  // The moment the page opened, for "done in the last 14 days".
  const [openedAt] = useState(() => Date.now());
  const [projects, setProjects] = useState<ProjectFilter>(project ?? 'rotation');
  const [stage, setStage] = useState<StageFilter>('current');
  const [zone, setZone] = useState('');
  const [kind, setKind] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState<{ text: string; projectId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);

  const update = writePrefs;

  const projectList = useMemo(() => {
    const seen = new Map<number, { id: number; title: string; place: Todo['place'] }>();
    for (const t of todos) if (!seen.has(t.projectId)) seen.set(t.projectId, { id: t.projectId, title: t.projectTitle, place: t.place });
    return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [todos]);
  const zones = useMemo(() => [...new Set(todos.map((t) => t.element?.split(' / ')[0]).filter((z): z is string => !!z))].sort(), [todos]);
  const kinds = useMemo(() => [...new Set(todos.map((t) => t.kind).filter((k): k is string => !!k))].sort(), [todos]);

  const since = prefs.window ? openedAt - prefs.window * 86_400_000 : 0;
  const shown = todos.filter((t) => {
    if (projects === 'rotation' && t.place !== 'rotation') return false;
    if (projects === 'board' && t.place === null) return false;
    if (typeof projects === 'number' && t.projectId !== projects) return false;
    if (stage === 'current' && t.when !== 'current') return false;
    if (stage === 'parked' && t.when === 'earlier') return false;
    if (zone && t.element?.split(' / ')[0] !== zone) return false;
    if (kind && t.kind !== kind) return false;
    if (t.status === 'done' && (!prefs.showDone || Date.parse(t.updatedAt) < since)) return false;
    return true;
  });
  const open = shown.filter((t) => t.status !== 'done').length;
  const done = shown.length - open;
  const columns = prefs.showDone ? TODO_COLUMNS : TODO_COLUMNS.filter((c) => c.status !== 'done');
  const lanes = prefs.byProject
    ? projectList.filter((p) => shown.some((t) => t.projectId === p.id)).map((p) => ({ key: String(p.id), project: p, items: shown.filter((t) => t.projectId === p.id) }))
    : [{ key: 'all', project: null, items: shown }];

  async function setStatus(t: Todo, status: TodoStatus) {
    if (t.status === status || !t.canChange) return;
    setError('');
    setBusy(true);
    const r = await api(`/api/cards/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body?.error || 'That did not go through.');
      return;
    }
    setTodos((l) => l.map((x) => (x.id === t.id ? { ...x, status, updatedAt: new Date().toISOString() } : x)));
  }

  async function toNote(t: Todo) {
    setError('');
    setBusy(true);
    const r = await api(`/api/cards/${t.id}/move`, { method: 'POST', body: JSON.stringify({ to: 'note' }) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body?.error || 'That did not go through.');
      return;
    }
    setTodos((l) => l.filter((x) => x.id !== t.id));
    setMessage({ text: `“${t.what}” is a note on ${t.projectTitle} now.`, projectId: t.projectId });
  }

  const grid = { gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-title">To-dos</h1>
          <p className="t-body text-muted">
            Every card across your projects. {open} open{prefs.showDone ? `, ${done} done${prefs.window ? ` in the last ${prefs.window} days` : ''}` : '; done cards hidden'}.
          </p>
        </div>
        <div className={SEGMENTS} role="group" aria-label="View">
          <button type="button" onClick={() => update({ view: 'board' })} aria-pressed={prefs.view === 'board'} className={SEGMENT(prefs.view === 'board')}>
            Board
          </button>
          <button type="button" onClick={() => update({ view: 'list' })} aria-pressed={prefs.view === 'list'} className={SEGMENT(prefs.view === 'list')}>
            List
          </button>
        </div>
      </div>

      <section aria-label="Filters" className="t-body mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-ink/[0.03] px-3 py-2">
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Projects
          <select
            value={String(projects)}
            onChange={(e) => {
              const v = e.target.value;
              setProjects(v === 'rotation' || v === 'board' || v === 'all' ? v : Number(v));
            }}
            className={FIELD}
          >
            <option value="rotation">In rotation</option>
            <option value="board">On my board</option>
            <option value="all">Every project</option>
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Stage
          <select value={stage} onChange={(e) => setStage(e.target.value as StageFilter)} className={FIELD}>
            <option value="current">Each project&rsquo;s current stage</option>
            <option value="parked">Current and parked for later</option>
            <option value="any">Any stage</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Element
          <select value={zone} onChange={(e) => setZone(e.target.value)} className={FIELD}>
            <option value="">All</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={FIELD}>
            <option value="">All</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[12px]">
          <input type="checkbox" checked={prefs.showDone} onChange={(e) => update({ showDone: e.target.checked })} className="accent-ink" />
          Show done
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          from
          <select value={prefs.window} onChange={(e) => update({ window: Number(e.target.value) as Window })} disabled={!prefs.showDone} className={FIELD}>
            <option value={14}>the last 14 days</option>
            <option value={30}>the last 30 days</option>
            <option value={0}>any time</option>
          </select>
        </label>
        {prefs.view === 'board' && (
          <label className="flex items-center gap-1.5 text-[12px]">
            <input type="checkbox" checked={prefs.byProject} onChange={(e) => update({ byProject: e.target.checked })} className="accent-ink" />
            One row per project
          </label>
        )}
      </section>

      {error && <p className="t-body mb-3 text-rust">{error}</p>}
      {message && (
        <p role="status" className="t-body mb-3 flex flex-wrap items-center gap-3 rounded border border-ink px-3 py-1.5">
          <span>{message.text}</span>
          <Link href={`/projects/${message.projectId}?tab=notes`} className={TEXT_LINK}>
            Open its notes
          </Link>
          <button type="button" onClick={() => setMessage(null)} className={BUTTON}>
            Done
          </button>
        </p>
      )}

      {shown.length === 0 && (
        <p className="t-body text-muted">
          Nothing here with these filters.{' '}
          {projects === 'rotation' && 'Only projects in rotation are shown; choose “On my board” or “Every project” to see more.'}
        </p>
      )}

      {prefs.view === 'board' && shown.length > 0 && (
        <div className="space-y-5">
          <div className="grid gap-3" style={grid}>
            {columns.map((c) => (
              <p key={c.status} className="t-label px-0.5">
                {c.label} · {shown.filter((t) => t.status === c.status).length}
              </p>
            ))}
          </div>
          {lanes.map((lane) => (
            <div key={lane.key} className="space-y-1.5">
              {lane.project && (
                <p className="flex flex-wrap items-baseline gap-2 border-t border-line pt-2.5">
                  <Link href={`/projects/${lane.project.id}?tab=workflow`} className="text-[14px] font-medium hover:text-rust">
                    {lane.project.title}
                  </Link>
                  <span className="t-num font-mono text-[10px] text-muted">
                    {lane.items[0]?.projectStageLabel ?? 'not started'}
                    {lane.project.place ? ` · ${lane.project.place === 'rotation' ? 'in rotation' : 'backlog'}` : ''}
                  </span>
                </p>
              )}
              <div className="grid gap-3" style={grid}>
                {columns.map((c) => (
                  <div
                    key={c.status}
                    onDragOver={(e) => dragging !== null && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const t = todos.find((x) => x.id === dragging);
                      setDragging(null);
                      if (t && (!lane.project || t.projectId === lane.project.id)) void setStatus(t, c.status);
                    }}
                    className={`min-h-16 space-y-2 rounded-md bg-ink/[0.03] p-2 ${dragging !== null ? 'outline-dashed outline-1 outline-ink/20' : ''}`}
                  >
                    {lane.items
                      .filter((t) => t.status === c.status)
                      .map((t) => (
                        <TodoCard
                          key={t.id}
                          t={t}
                          withProject={!lane.project}
                          busy={busy}
                          onDrag={setDragging}
                          onNext={() => setStatus(t, NEXT[t.status].to)}
                          onNote={() => toNote(t)}
                        />
                      ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-muted">
            Drag a card between columns to change its status, or use its button. A card for a later stage shows with &ldquo;Current and parked for later&rdquo;.
          </p>
        </div>
      )}

      {prefs.view === 'list' && shown.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="t-body w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="t-label bg-ink/[0.03] text-left">
                <th className="px-2.5 py-2 font-normal">Done</th>
                <th className="px-2.5 py-2 font-normal">To-do</th>
                <th className="px-2.5 py-2 font-normal">Project</th>
                <th className="px-2.5 py-2 font-normal">Stage</th>
                <th className="px-2.5 py-2 font-normal">Element</th>
                <th className="px-2.5 py-2 font-normal">Moment</th>
                <th className="px-2.5 py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="border-t border-line align-top">
                  <td className="px-2.5 py-2">
                    <input
                      type="checkbox"
                      checked={t.status === 'done'}
                      disabled={!t.canChange || busy}
                      onChange={(e) => setStatus(t, e.target.checked ? 'done' : 'accepted')}
                      aria-label={`Done: ${t.what}`}
                      className="accent-ink"
                    />
                    {t.status === 'in progress' && <span className="ml-1.5 font-mono text-[10px] text-muted">in progress</span>}
                  </td>
                  <td className="px-2.5 py-2">
                    <span className={t.status === 'done' ? 'text-muted line-through' : 'font-medium'}>
                      {t.isNext && <span className="mr-1.5 rounded bg-ink px-1 py-px font-mono text-[10px] uppercase tracking-wide text-parchment">Next</span>}
                      {t.what}
                    </span>
                    <span className="block text-[12px] text-muted">Done when: {t.doneWhen}</span>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2">
                    <Link href={`/projects/${t.projectId}?tab=workflow`} className="hover:text-rust">
                      {t.projectTitle}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2">
                    {t.stageLabel}
                    {t.when === 'later' && <span className="text-muted"> · parked</span>}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2">{t.element ?? <span className="text-muted">unassigned</span>}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 font-mono text-[11px] text-muted">{t.moment ?? ''}</td>
                  <td className="whitespace-nowrap px-2.5 py-2">
                    {t.canChange && (
                      <button type="button" onClick={() => toNote(t)} disabled={busy} className={BUTTON} aria-label={`Make “${t.what}” a note`}>
                        → Note
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TodoCard({
  t,
  withProject,
  busy,
  onDrag,
  onNext,
  onNote,
}: {
  t: Todo;
  withProject: boolean;
  busy: boolean;
  onDrag: (id: number | null) => void;
  onNext: () => void;
  onNote: () => void;
}) {
  const tag = [withProject ? t.projectTitle : null, t.stageLabel + (t.when === 'later' ? ' (parked)' : ''), t.element ?? 'unassigned'].filter(Boolean).join(' · ');
  return (
    <article
      draggable={t.canChange}
      onDragStart={() => onDrag(t.id)}
      onDragEnd={() => onDrag(null)}
      className={`t-body space-y-1 rounded border bg-card px-3 py-2.5 ${t.status === 'in progress' ? 'border-ink' : 'border-line'} ${t.canChange ? 'cursor-grab' : ''}`}
    >
      <p className="flex justify-between gap-2 font-mono text-[10px] text-muted">
        <span className="min-w-0">{tag}</span>
        <span className="shrink-0">{t.kind ?? ''}</span>
      </p>
      <p className={t.status === 'done' ? 'font-medium text-muted line-through' : 'font-medium'}>
        {t.isNext && <span className="mr-1.5 rounded bg-ink px-1 py-px font-mono text-[10px] uppercase tracking-wide text-parchment">Next</span>}
        {t.what}
      </p>
      <p className="text-[12px] text-muted">Done when: {t.doneWhen}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted">{t.moment ? `Pinned to ${t.moment}` : ''}</span>
        {t.canChange && (
          <span className="flex gap-1.5">
            <button type="button" onClick={onNext} disabled={busy} className={BUTTON}>
              {NEXT[t.status].label}
            </button>
            <button type="button" onClick={onNote} disabled={busy} className={BUTTON} aria-label={`Make “${t.what}” a note`}>
              → Note
            </button>
          </span>
        )}
      </div>
    </article>
  );
}

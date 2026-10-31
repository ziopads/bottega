'use client';

import Link from 'next/link';
import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON, FIELD, SEGMENT, SEGMENTS } from '@/app/_ui/styles';
import { daysSince, progressOf, type Board, type BoardCandidate, type BoardPlace, type BoardProject } from '@/lib/boardTypes';
import Method, { type MethodPrinciple } from '@/app/_ui/Method';
import BoardDetail from './BoardDetail';

// The board (REQUIREMENTS W-21 to W-23), laid out on 25 October like the
// rack and channel strip of the Finish Line prototype:
//
//   In rotation   on the left, a rack of at most the person's limit: each
//                 project with its stage bar and next to-do; choosing one
//                 shows it on the right
//   On the right  the chosen project's Where it stands (BoardDetail), where
//                 its to-dos can be worked; ↓ Backlog sends it back
//   Backlog       below, a grid, sortable; ↑ rotates a project in, × takes it
//                 off the board; at its foot, + Add a project (search, the
//                 top five by newest, last worked on or stars, or a new one)
//
// Finished projects leave the board: the header counts them and links to the
// Projects list filtered to them. Projects drag between Backlog and In
// rotation, and from Add onto either; stage moves stay on the project's
// Workflow tab. When rotation is full, moving one in asks which one goes out.

type Sort = 'progress' | 'cold' | 'recent' | 'title';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'progress', label: 'Furthest along' },
  { key: 'cold', label: 'Coldest' },
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'A–Z' },
];

export default function BoardView({ initial, method = [] }: { initial: Board; method?: MethodPrinciple[] }) {
  const [board, setBoard] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<Sort>('progress');
  const [swapFor, setSwapFor] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  async function post(body: unknown): Promise<boolean> {
    setError('');
    setBusy(true);
    const r = await api<{ board: Board }>('/api/board', { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'That did not go through.');
      return false;
    }
    setBoard(r.data.board);
    return true;
  }

  const unfinished = board.projects.filter((p) => !p.finishedAt);
  const rotation = unfinished.filter((p) => p.place === 'rotation');
  const backlog = unfinished.filter((p) => p.place === 'backlog');
  const finished = board.projects.filter((p) => p.finishedAt).sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  const full = rotation.length >= board.rotationLimit;

  const byRecent = (a: BoardProject, b: BoardProject) => (b.touchedAt ?? '').localeCompare(a.touchedAt ?? '');
  const sorted = backlog.slice().sort((a, b) => {
    if (sort === 'progress') return progressOf(b) - progressOf(a) || byRecent(a, b);
    if (sort === 'cold') return -byRecent(a, b);
    if (sort === 'recent') return byRecent(a, b);
    return a.title.localeCompare(b.title);
  });
  rotation.sort(byRecent);
  // The project shown on the right: the one chosen, else the most recently worked on.
  const selected = rotation.find((p) => p.id === selectedId) ?? rotation[0] ?? null;

  async function reload() {
    const r = await api<{ board: Board }>('/api/board', { method: 'GET' });
    if (r.ok) setBoard(r.data.board);
  }

  async function moveTo(id: number, place: BoardPlace) {
    const p = board.projects.find((x) => x.id === id);
    if (p && p.place === place) return;
    if (place === 'rotation' && full) {
      // Rotation is full: a project not yet on the board waits in the backlog while the person picks one to swap out.
      if (p || (await post({ op: 'place', projectId: id, place: 'backlog' }))) setSwapFor(id);
      return;
    }
    setSwapFor(null);
    void post({ op: 'place', projectId: id, place });
  }

  const dropZone = (place: BoardPlace) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragging !== null) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragging !== null) moveTo(dragging, place);
      setDragging(null);
    },
  });
  const dragProps = (id: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      setDragging(id);
    },
    onDragEnd: () => setDragging(null),
  });

  const swapping = swapFor === null ? null : board.projects.find((p) => p.id === swapFor) ?? null;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-title">Board</h1>
          <p className="t-body text-muted">Projects move from the backlog into rotation; a finished one leaves the board.</p>
        </div>
        {finished.length > 0 && (
          <Link href="/projects?show=finished" className="t-body text-muted underline decoration-ink/30 underline-offset-2 hover:text-ink hover:decoration-ink">
            {finished.length} finished →
          </Link>
        )}
      </div>

      {error && <p className="t-body mb-4 text-rust">{error}</p>}

      {swapping && (
        <div className="t-body mb-4 rounded border border-ink px-3 py-2">
          <p>
            Rotation is full ({rotation.length} of {board.rotationLimit}). Which project goes back to the backlog to make room for{' '}
            <span className="font-medium">{swapping.title}</span>?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {rotation.map((p) => (
              <button key={p.id} onClick={() => post({ op: 'swap', inId: swapping.id, outId: p.id }).then((ok) => ok && setSwapFor(null))} disabled={busy} className={BUTTON}>
                {p.title} · {stageWord(p)}
              </button>
            ))}
            <button onClick={() => setSwapFor(null)} className={BUTTON}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-label="In rotation"
          {...dropZone('rotation')}
          className={`min-w-0 flex-[1_1_320px] space-y-2 lg:max-w-[24rem] ${dragging !== null ? 'rounded-md outline-dashed outline-1 outline-ink/30' : ''}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="t-section">
              In rotation · {rotation.length} of {board.rotationLimit}
            </p>
            <Link href="/account?tab=preferences#board" className="t-small text-muted underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
              Limit
            </Link>
          </div>
          {rotation.map((p) => {
            const on = p.id === selected?.id;
            return (
              <article
                key={p.id}
                {...dragProps(p.id)}
                className={`t-body rounded-[var(--radius)] border bg-card ${on ? 'border-rust shadow-[inset_3px_0_0_var(--rust)]' : isCold(p, board.coldDays) ? 'border-dashed border-cold' : 'border-line hover:border-muted'}`}
              >
                <button type="button" onClick={() => setSelectedId(p.id)} aria-pressed={on} className="block w-full space-y-1.5 p-3 text-left">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="t-lead min-w-0 truncate font-medium" style={{ fontFamily: 'var(--font-display)', textTransform: 'var(--title-case)' as React.CSSProperties['textTransform'], letterSpacing: 'var(--title-spacing)' }}>
                      {p.title}
                    </span>
                    <span className="t-num shrink-0 t-small text-muted">{[p.bpm ? `${p.bpm}` : null, p.key].filter(Boolean).join(' · ') || p.code}</span>
                  </span>
                  <Meter p={p} size="small" />
                  <span className="block truncate t-small text-muted">
                    {p.next ? (
                      <>
                        <span className="text-ink">Next:</span> {p.next}
                      </>
                    ) : (
                      'No to-do marked next'
                    )}
                  </span>
                  <Foot p={p} coldDays={board.coldDays} />
                </button>
              </article>
            );
          })}
          {Array.from({ length: Math.max(0, board.rotationLimit - rotation.length) }, (_, i) => (
            <div key={i} className="t-small rounded-[var(--radius)] border border-dashed border-line p-3 text-muted">
              Open slot. {backlog.length ? 'Drag a project up from the backlog, or press ↑ on one.' : 'Add a project in the backlog below.'}
            </div>
          ))}
          {rotation.length > board.rotationLimit && (
            <p className="t-body text-rust">
              {rotation.length - board.rotationLimit} over the limit. Send {rotation.length - board.rotationLimit > 1 ? 'some' : 'one'} back to the backlog.
            </p>
          )}
        </section>

        <div className="min-w-0 flex-[999_1_480px]">
          {selected ? (
            <BoardDetail key={selected.id} project={selected} coldDays={board.coldDays} busy={busy} onBack={() => moveTo(selected.id, 'backlog')} onChanged={reload} />
          ) : (
            <p className="t-body text-muted">Projects in rotation show here, one at a time: choose one on the left.</p>
          )}
        </div>
      </div>

      <section
        aria-label="Backlog"
        {...dropZone('backlog')}
        className={`mt-10 space-y-3 ${dragging !== null ? 'rounded-md outline-dashed outline-1 outline-ink/30' : ''}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-[length:var(--rule)] border-line pb-1">
          <p className="t-section">Backlog · {backlog.length}</p>
          {backlog.length > 1 && (
            <label className="flex items-center gap-1.5 t-small text-muted">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${FIELD} t-small`}>
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {sorted.length === 0 && <p className="t-body text-muted">Nothing waiting. Projects you send back from rotation wait here.</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          {sorted.map((p) => (
            <article key={p.id} {...dragProps(p.id)} className={`t-body space-y-1.5 rounded-[var(--radius)] border bg-card p-2.5 ${isCold(p, board.coldDays) ? 'border-dashed border-cold' : 'border-line'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/projects/${p.id}?tab=workflow`} className="min-w-0 truncate font-medium hover:text-rust">
                  {p.title}
                </Link>
                <span className="flex shrink-0 gap-1">
                  <button onClick={() => moveTo(p.id, 'rotation')} disabled={busy} className={BUTTON} title="Move into rotation" aria-label={`Rotate ${p.title} in`}>
                    ↑
                  </button>
                  <button onClick={() => post({ op: 'remove', projectId: p.id })} disabled={busy} className={BUTTON} aria-label={`Take ${p.title} off the board`} title="Take off the board">
                    ×
                  </button>
                </span>
              </div>
              <Meter p={p} size="small" />
              <Foot p={p} coldDays={board.coldDays} />
            </article>
          ))}
        </div>
        <div className="max-w-2xl">
          <AddToBoard
            candidates={board.candidates}
            busy={busy}
            onPlace={(id, place) => moveTo(id, place)}
            onDrag={setDragging}
            onCreated={(b) => setBoard(b)}
            onError={setError}
          />
        </div>
      </section>
      {board.projects.length === 0 && (
        <p className="t-body mt-6 text-muted">
          Your board is empty. A project lands in your backlog when its workflow starts; add any project you can see with + Add a project in the backlog. <Link href="/projects" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">All projects</Link>
        </p>
      )}
      <Method principles={method} editHref="/account?tab=preferences#template" />
    </div>
  );
}

function isCold(p: BoardProject, coldDays: number): boolean {
  const d = daysSince(p.touchedAt);
  return d !== null && d >= coldDays;
}

function formatDay(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

function stageWord(p: BoardProject): string {
  if (!p.stage) return 'not started';
  const i = p.stages.findIndex((s) => s.key === p.stage);
  return i < 0 ? p.stage : `${p.stages[i].label}`;
}

/** One segment per stage, as on the Workflow tab. */
function Meter({ p, size }: { p: BoardProject; size: 'small' | 'large' }) {
  if (!p.stages.length) return <p className="t-small text-muted">Workflow not started.</p>;
  const cur = p.stages.findIndex((s) => s.key === p.stage);
  const columns = { gridTemplateColumns: `repeat(${p.stages.length}, minmax(0, 1fr))` };
  const label = cur < 0 ? '' : `At ${p.stages[cur].label}, ${p.stages[cur].met} of ${p.stages[cur].total} done`;
  return (
    <div>
      <div className={`grid ${size === 'large' ? 'gap-[3px]' : 'gap-0.5'}`} style={columns} role="img" aria-label={label}>
        {p.stages.map((s, i) => {
          const share = s.total ? s.met / s.total : i < cur ? 1 : 0;
          return (
            <span key={s.key} className={`relative block overflow-hidden rounded-[1px] bg-led-off ${size === 'large' ? 'h-2' : 'h-[5px]'} ${i === cur ? 'ring-1 ring-meter-now' : ''}`}>
              <span className={`absolute inset-y-0 left-0 ${share >= 1 ? 'bg-meter-done' : 'bg-meter-now'}`} style={{ width: `${Math.round(share * 100)}%` }} />
            </span>
          );
        })}
      </div>
      {size === 'large' && (
        <div className="mt-1 grid gap-[3px] font-mono text-[9px] uppercase tracking-wide text-muted" style={columns}>
          {p.stages.map((s, i) => (
            <span key={s.key} className={`min-w-0 truncate ${i === cur ? 'font-medium text-ink' : ''}`}>
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Foot({ p, coldDays, withCards = false }: { p: BoardProject; coldDays: number; withCards?: boolean }) {
  const d = daysSince(p.touchedAt);
  const cur = p.stages.findIndex((s) => s.key === p.stage);
  const where = cur < 0 ? 'Not started' : `Stage ${cur + 1} · ${p.stages[cur].label} · ${p.stages[cur].met}/${p.stages[cur].total}`;
  const age = d === null ? '' : d >= coldDays ? `cold · ${d}d` : d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`;
  return (
    <p className="t-num flex flex-wrap justify-between gap-2 font-mono t-small text-muted">
      <span>
        {where}
        {withCards && p.openCards > 0 && (
          <>
            {' · '}
            <Link href={`/todos?project=${p.id}`} className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
              {p.openCards} open {p.openCards === 1 ? 'to-do' : 'to-dos'}
            </Link>
          </>
        )}
        {!withCards && p.ownerName ? ` · ${p.ownerName}` : ''}
      </span>
      <span className={d === null ? '' : d >= coldDays ? 'font-medium text-cold' : d >= 7 ? 'text-cooling' : 'text-fresh'}>{age}</span>
    </p>
  );
}

/** "2026 1024": today as a canonical id starts, as the Ableton folders are named. */
function todaysId(): string {
  const d = new Date();
  return `${d.getFullYear()} ${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

type AddSort = 'new' | 'touched' | 'stars';
const ADD_SORTS: { key: AddSort; label: string }[] = [
  { key: 'new', label: 'Newest' },
  { key: 'touched', label: 'Last worked on' },
  { key: 'stars', label: 'Stars' },
];

function sortCandidates(list: BoardCandidate[], sort: AddSort): BoardCandidate[] {
  const own = (c: BoardCandidate) => Number(c.ownerName !== null);
  const by: Record<AddSort, (a: BoardCandidate, b: BoardCandidate) => number> = {
    new: (a, b) => b.createdAt.localeCompare(a.createdAt),
    touched: (a, b) => (b.touchedAt ?? '').localeCompare(a.touchedAt ?? ''),
    stars: (a, b) => b.rating - a.rating || (b.touchedAt ?? '').localeCompare(a.touchedAt ?? ''),
  };
  return [...list].sort((a, b) => own(a) - own(b) || by[sort](a, b));
}

/** Adding to the board (24 October; moved to the foot of the backlog on 25
 *  October, as Jira adds at the foot of a column): one line until opened,
 *  then a search, the top five by newest, last worked on or stars, and a new
 *  project from a name that matches nothing. */
function AddToBoard({
  candidates,
  busy,
  onPlace,
  onDrag,
  onCreated,
  onError,
}: {
  candidates: BoardCandidate[];
  busy: boolean;
  onPlace: (id: number, place: BoardPlace) => void;
  onDrag: (id: number | null) => void;
  onCreated: (board: Board) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<AddSort>('new');
  const [making, setMaking] = useState(false);
  const [canonicalId, setCanonicalId] = useState('');
  const [place, setPlace] = useState<BoardPlace>('backlog');
  const [saving, setSaving] = useState(false);
  const q = query.trim().toLowerCase();
  const ordered = sortCandidates(candidates, sort);
  const matches = (q ? ordered.filter((c) => c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) : ordered).slice(0, q ? 8 : 5);

  function close() {
    setOpen(false);
    setQuery('');
    setMaking(false);
  }

  async function make(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    setSaving(true);
    const r = await api<{ project: { id: number } }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ canonicalId, workingName: query.trim() }),
    });
    if (!r.ok) {
      setSaving(false);
      const hint = r.body?.suggestion ? ` Try “${r.body.suggestion}”.` : '';
      onError((r.body?.error || 'Could not make the project.') + hint);
      return;
    }
    // A new project lands in the backlog; rotation is one more step.
    const b =
      place === 'rotation'
        ? await api<{ board: Board }>('/api/board', { method: 'POST', body: JSON.stringify({ op: 'place', projectId: r.data.project.id, place: 'rotation' }) })
        : await api<{ board: Board }>('/api/board', { method: 'GET' });
    setSaving(false);
    if (!b.ok) {
      onError(b.body?.error || 'The project was made but could not go into rotation; it is in the backlog.');
      const again = await api<{ board: Board }>('/api/board', { method: 'GET' });
      if (again.ok) onCreated(again.data.board);
    } else {
      onCreated(b.data.board);
    }
    close();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="t-body w-full rounded border border-dashed border-line px-2.5 py-2 text-left text-muted hover:border-ink hover:text-ink"
      >
        + Add a project
      </button>
    );
  }

  return (
    <section aria-label="Add to the board" className="t-body space-y-2 rounded border border-ink bg-card p-2.5">
      <div className="flex items-center gap-2">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMaking(false);
          }}
          onKeyDown={(e) => e.key === 'Escape' && close()}
          placeholder="Name or date, such as khione or 2025 0727"
          aria-label="Find a project to add"
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button type="button" onClick={close} className={BUTTON}>
          Close
        </button>
      </div>
      {!q && (
        <div className="flex flex-wrap items-center gap-2 t-small text-muted">
          <span>Top five by</span>
          <span className={SEGMENTS}>
            {ADD_SORTS.map((s) => (
              <button key={s.key} type="button" onClick={() => setSort(s.key)} className={SEGMENT(sort === s.key)} aria-pressed={sort === s.key}>
                {s.label}
              </button>
            ))}
          </span>
        </div>
      )}
      {matches.length > 0 && (
        <ul className="divide-y divide-line">
          {matches.map((c) => (
            <li
              key={c.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                onDrag(c.id);
              }}
              onDragEnd={() => onDrag(null)}
              className="flex cursor-grab flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.title}</span>{' '}
                <span className="t-num t-small text-muted">
                  {c.code}
                  {c.rating > 0 ? ` · ${'★'.repeat(c.rating)}` : ''}
                  {sort === 'touched' && !q && c.touchedAt ? ` · ${formatDay(c.touchedAt)}` : ''}
                </span>
                {c.ownerName && <span className="t-small text-muted"> · {c.ownerName}</span>}
              </span>
              <span className="flex gap-1">
                <button type="button" onClick={() => onPlace(c.id, 'backlog')} disabled={busy} className={BUTTON}>
                  Backlog
                </button>
                <button type="button" onClick={() => onPlace(c.id, 'rotation')} disabled={busy} className={BUTTON}>
                  Rotation
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!q && candidates.length > matches.length && (
        <p className="t-small text-muted">
          {matches.length} of {candidates.length} projects not on your board; search for the rest, or drag one into rotation.
        </p>
      )}
      {!q && candidates.length === 0 && <p className="text-muted">Every project you can see is on your board.</p>}
      {q && matches.length === 0 && !making && <p className="text-muted">No project matches “{query.trim()}”.</p>}
      {q && !making && (
        <button
          type="button"
          onClick={() => {
            setMaking(true);
            setCanonicalId((id) => id || todaysId());
          }}
          className={BUTTON}
        >
          + New project “{query.trim()}”
        </button>
      )}
      {making && (
        <form onSubmit={make} className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
          <label className="flex flex-col gap-0.5 t-small text-muted">
            Canonical ID
            <input value={canonicalId} onChange={(e) => setCanonicalId(e.target.value)} className={`${FIELD} font-mono`} />
          </label>
          <label className="flex flex-col gap-0.5 t-small text-muted">
            Working name
            <input value={query} onChange={(e) => setQuery(e.target.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-0.5 t-small text-muted">
            Goes to
            <select value={place} onChange={(e) => setPlace(e.target.value === 'rotation' ? 'rotation' : 'backlog')} className={FIELD}>
              <option value="backlog">Backlog</option>
              <option value="rotation">Rotation</option>
            </select>
          </label>
          <button type="submit" disabled={saving || !canonicalId.trim()} className={BUTTON}>
            {saving ? 'Making…' : 'Make it'}
          </button>
          <button type="button" onClick={() => setMaking(false)} className={BUTTON}>
            Cancel
          </button>
          <p className="w-full t-small text-muted">
            The canonical ID is the start of the project&rsquo;s Ableton folder name (the date), so the watcher finds it. It is credited to your default artist.
          </p>
        </form>
      )}
    </section>
  );
}

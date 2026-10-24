'use client';

import Link from 'next/link';
import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON, FIELD } from '@/app/_ui/styles';
import { daysSince, progressOf, type Board, type BoardCandidate, type BoardPlace, type BoardProject } from '@/lib/boardTypes';

// The board (REQUIREMENTS W-21 to W-23), layout B of 23 October: projects
// move left to right, from the backlog into rotation and on to finished.
//
//   Backlog       sortable; ↑ rotates a project in, × takes it off the board
//   In rotation   at most the person's limit; each project with its stage bar
//                 and the next move; ↓ sends it back
//   Finished      projects whose last stage's criteria are all met
//
// Projects drag between Backlog and In rotation; stage moves stay on the
// project's Workflow tab. When rotation is full, moving one in asks which
// one goes out. Adding (24 October): a search box above the columns, newest
// projects first; each result goes to the backlog or rotation with one click
// or a drag onto either column, and a name that matches nothing can become a
// new project there and then.

type Sort = 'progress' | 'cold' | 'recent' | 'title';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'progress', label: 'Furthest along' },
  { key: 'cold', label: 'Coldest' },
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'A–Z' },
];

export default function BoardView({ initial }: { initial: Board }) {
  const [board, setBoard] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<Sort>('progress');
  const [swapFor, setSwapFor] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

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
          <p className="t-body text-muted">Projects move left to right: from the backlog into rotation, and on to finished.</p>
        </div>
      </div>

      <AddToBoard
        candidates={board.candidates}
        busy={busy}
        onPlace={(id, place) => moveTo(id, place)}
        onDrag={setDragging}
        onCreated={(b) => setBoard(b)}
        onError={setError}
      />

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

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-label="Backlog"
          {...dropZone('backlog')}
          className={`min-w-0 flex-[1_1_300px] space-y-2 rounded-md bg-ink/[0.03] p-3 ${dragging !== null ? 'outline-dashed outline-1 outline-ink/30' : ''}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="t-label">Backlog · {backlog.length}</p>
            {backlog.length > 1 && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${FIELD} text-[11px]`}>
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
          {sorted.length + rotation.length > 0 && (
            <p className="text-[11px] text-muted">Drag a project between the backlog and rotation, or onto either from the search above.</p>
          )}
          {sorted.map((p) => (
            <article key={p.id} {...dragProps(p.id)} className={`t-body space-y-1.5 rounded border bg-card p-2.5 ${isCold(p, board.coldDays) ? 'border-dashed border-ink/40' : 'border-line'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/projects/${p.id}?tab=workflow`} className="min-w-0 font-medium hover:text-rust">
                  {p.title}
                </Link>
                <span className="flex shrink-0 gap-1">
                  <button onClick={() => moveTo(p.id, 'rotation')} disabled={busy} className={BUTTON} title="Move into rotation">
                    ↑ Rotate in
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
        </section>

        <section
          aria-label="In rotation"
          {...dropZone('rotation')}
          className={`min-w-0 flex-[2.2_1_560px] space-y-3 rounded-md border border-ink p-3 ${dragging !== null ? 'outline-dashed outline-1 outline-ink/30' : ''}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="t-label">
              In rotation · {rotation.length} of {board.rotationLimit}
            </p>
            <p className="text-[11px] text-muted">
              The limit is in <Link href="/account?tab=preferences" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">Preferences</Link> · ↓ sends a project back
            </p>
          </div>
          {rotation.map((p) => (
            <article key={p.id} {...dragProps(p.id)} className={`t-body space-y-2.5 rounded border p-3.5 ${isCold(p, board.coldDays) ? 'border-dashed border-ink/40' : 'border-ink/20'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/projects/${p.id}?tab=workflow`} className="text-[16px] font-medium hover:text-rust">
                  {p.title}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="t-num font-mono text-[11px] text-muted">
                    {p.code}
                    {p.bpm ? ` · ${p.bpm} BPM` : ''}
                    {p.ownerName ? ` · ${p.ownerName}` : ''}
                  </span>
                  <button onClick={() => moveTo(p.id, 'backlog')} disabled={busy} className={BUTTON} aria-label={`Send ${p.title} back to the backlog`} title="Back to the backlog">
                    ↓
                  </button>
                </span>
              </div>
              <Meter p={p} size="large" />
              <div className="border-t border-line pt-2">
                <p className="t-label">Next</p>
                <p className="text-[14px]">{p.next || <span className="text-muted">No to-do marked next.</span>}</p>
              </div>
              <Foot p={p} coldDays={board.coldDays} withCards />
            </article>
          ))}
          {Array.from({ length: Math.max(0, board.rotationLimit - rotation.length) }, (_, i) => (
            <div key={i} className="t-body rounded border border-dashed border-line p-3.5 text-muted">
              Open slot. {backlog.length ? 'Rotate a project in from the backlog.' : 'Add a project to the board.'}
            </div>
          ))}
          {rotation.length > board.rotationLimit && (
            <p className="t-body text-rust">
              {rotation.length - board.rotationLimit} over the limit. Send {rotation.length - board.rotationLimit > 1 ? 'some' : 'one'} back to the backlog.
            </p>
          )}
        </section>

        <section aria-label="Finished" className="min-w-0 flex-[0.8_1_220px] space-y-2 rounded-md bg-ink/[0.03] p-3">
          <p className="t-label">Finished · {finished.length}</p>
          {finished.length === 0 && <p className="t-body text-muted">A project lands here when every criterion of its last stage is met.</p>}
          {finished.map((p) => (
            <article key={p.id} className="t-body rounded border border-line bg-card p-2.5">
              <Link href={`/projects/${p.id}?tab=workflow`} className="font-medium hover:text-rust">
                {p.title}
              </Link>
              <p className="t-num font-mono text-[10px] text-muted">finished {formatDay(p.finishedAt)}</p>
            </article>
          ))}
        </section>
      </div>
      {board.projects.length === 0 && (
        <p className="t-body mt-6 text-muted">
          Your board is empty. A project lands in your backlog when its workflow starts; add any project you can see with the menu above. <Link href="/projects" className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">All projects</Link>
        </p>
      )}
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
  if (!p.stages.length) return <p className="text-[11px] text-muted">Workflow not started.</p>;
  const cur = p.stages.findIndex((s) => s.key === p.stage);
  const columns = { gridTemplateColumns: `repeat(${p.stages.length}, minmax(0, 1fr))` };
  const label = cur < 0 ? '' : `At ${p.stages[cur].label}, ${p.stages[cur].met} of ${p.stages[cur].total} criteria met`;
  return (
    <div>
      <div className={`grid ${size === 'large' ? 'gap-[3px]' : 'gap-0.5'}`} style={columns} role="img" aria-label={label}>
        {p.stages.map((s, i) => {
          const share = s.total ? s.met / s.total : i < cur ? 1 : 0;
          return (
            <span key={s.key} className={`relative block overflow-hidden rounded-[1px] bg-line ${size === 'large' ? 'h-2' : 'h-[5px]'} ${i === cur ? 'ring-1 ring-ink' : ''}`}>
              <span className={`absolute inset-y-0 left-0 ${share >= 1 ? 'bg-ink' : 'bg-ink/40'}`} style={{ width: `${Math.round(share * 100)}%` }} />
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
    <p className="t-num flex flex-wrap justify-between gap-2 font-mono text-[10px] text-muted">
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
      <span>{age}</span>
    </p>
  );
}

/** "2026 1024": today as a canonical id starts, as the Ableton folders are named. */
function todaysId(): string {
  const d = new Date();
  return `${d.getFullYear()} ${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Adding to the board: search every project one can see, newest first, and
 * put one in the backlog or rotation with a click or a drag; or make a new
 * project from the name typed, which lands on the board at once.
 */
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
  const [query, setQuery] = useState('');
  const [making, setMaking] = useState(false);
  const [canonicalId, setCanonicalId] = useState('');
  const [place, setPlace] = useState<BoardPlace>('backlog');
  const [saving, setSaving] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = (q ? candidates.filter((c) => c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) : candidates).slice(0, q ? 8 : 5);

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
    setQuery('');
    setMaking(false);
  }

  return (
    <section aria-label="Add to the board" className="t-body mb-5 rounded-md border border-line p-3">
      <label className="flex flex-wrap items-center gap-2">
        <span className="t-label">Add to the board</span>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMaking(false);
          }}
          placeholder="Search by name or date, such as khione or 2025 0727"
          className={`${FIELD} min-w-0 flex-1`}
        />
      </label>
      {matches.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {matches.map((c) => (
            <li
              key={c.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                onDrag(c.id);
              }}
              onDragEnd={() => onDrag(null)}
              className="flex cursor-grab flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.title}</span> <span className="font-mono text-[11px] text-muted">{c.code}</span>
                {c.ownerName && <span className="text-[11px] text-muted"> · {c.ownerName}</span>}
              </span>
              <span className="flex gap-1.5">
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
        <p className="mt-1 text-[11px] text-muted">The newest {matches.length} of {candidates.length} projects not on your board; search for the rest.</p>
      )}
      {q && matches.length === 0 && !making && <p className="mt-2 text-muted">No project matches “{query.trim()}”.</p>}
      {q && !making && (
        <button
          type="button"
          onClick={() => {
            setMaking(true);
            setCanonicalId((id) => id || todaysId());
          }}
          className={`mt-2 ${BUTTON}`}
        >
          + New project “{query.trim()}”
        </button>
      )}
      {making && (
        <form onSubmit={make} className="mt-2 flex flex-wrap items-end gap-2 rounded border border-ink p-2.5">
          <label className="flex flex-col gap-0.5 text-[11px] text-muted">
            Canonical ID
            <input value={canonicalId} onChange={(e) => setCanonicalId(e.target.value)} className={`${FIELD} font-mono`} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-muted">
            Working name
            <input value={query} onChange={(e) => setQuery(e.target.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-muted">
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
          <p className="w-full text-[11px] text-muted">
            The canonical ID is the start of the project&rsquo;s Ableton folder name (the date), so the watcher finds it. It is credited to your default artist.
          </p>
        </form>
      )}
    </section>
  );
}

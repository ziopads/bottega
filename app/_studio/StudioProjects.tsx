'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudioArtist, StudioProject, StudioRelease } from '@/lib/studioTypes';
import { RATING_MAX, formatDuration } from '@/lib/studioTypes';
import { api, GenreSelect, InlineEdit, Stars } from './controls';
import NewProject from './NewProject';
import { BUTTON } from '@/app/_ui/styles';
import { get as deckState, itemOfProject, setRater, toggle as deckToggle, useDeck, type PlayItem } from '@/app/_ui/audio/deck';

// The sessions list: a sortable table with inline editing, multi-select with
// bulk changes, filters, and one shared player that steps through the rows as
// they are currently sorted and filtered.
//
// State is local and updated from each API response, so a change shows at once
// without re-fetching the whole list.

type SortKey = 'rating' | 'artist' | 'id' | 'name' | 'genre' | 'bpm' | 'versions' | 'length' | 'date' | 'upload';
type Sort = { key: SortKey; dir: 1 | -1 };

/** The direction a column sorts in on its first click. */
const FIRST_DIR: Record<SortKey, 1 | -1> = {
  rating: -1,
  artist: 1,
  id: -1,
  name: 1,
  genre: 1,
  bpm: 1,
  versions: -1,
  length: -1,
  date: -1,
  upload: -1,
};

function compare(a: StudioProject, b: StudioProject, key: SortKey): number {
  // Empty values sort last in either direction; see sortProjects.
  switch (key) {
    case 'rating':
      return a.rating - b.rating;
    case 'artist':
      return a.artist.code.localeCompare(b.artist.code);
    case 'id':
      return a.canonicalId.localeCompare(b.canonicalId);
    case 'name':
      return a.workingName.localeCompare(b.workingName, undefined, { sensitivity: 'base' });
    case 'genre':
      return a.genre.localeCompare(b.genre);
    case 'bpm':
      return (a.bpm ?? 0) - (b.bpm ?? 0);
    case 'versions':
      return (a.latest?.count ?? 0) - (b.latest?.count ?? 0);
    case 'length':
      return (a.latest?.durationS ?? 0) - (b.latest?.durationS ?? 0);
    case 'date':
      return a.createdAt.localeCompare(b.createdAt);
    case 'upload':
      return (a.latest?.uploadedAt ?? '').localeCompare(b.latest?.uploadedAt ?? '');
  }
}

function isEmpty(p: StudioProject, key: SortKey): boolean {
  return (
    (key === 'name' && !p.workingName) ||
    (key === 'genre' && !p.genre) ||
    (key === 'bpm' && p.bpm === null) ||
    (key === 'upload' && !p.latest) ||
    (key === 'length' && (p.latest?.durationS ?? null) === null)
  );
}

function sortProjects(list: StudioProject[], { key, dir }: Sort): StudioProject[] {
  return [...list].sort((a, b) => {
    const ea = isEmpty(a, key);
    const eb = isEmpty(b, key);
    if (ea !== eb) return ea ? 1 : -1;
    // Ties fall back to the newest session first, whatever the column.
    return dir * compare(a, b, key) || b.createdAt.localeCompare(a.createdAt);
  });
}

export default function StudioProjects({
  initialProjects,
  artists,
  initialGenres,
  initialReleases,
  defaultArtistId,
}: {
  initialProjects: StudioProject[];
  artists: StudioArtist[];
  initialGenres: string[];
  initialReleases: StudioRelease[];
  defaultArtistId: number | null;
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [genres, setGenres] = useState(initialGenres);
  const [releases, setReleases] = useState(initialReleases);
  const [error, setError] = useState('');

  // ── Filters and sort ──────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [artistFilter, setArtistFilter] = useState<number | ''>('');
  const [ratingFilter, setRatingFilter] = useState<'any' | 'unrated' | number>('any');
  const [genreFilter, setGenreFilter] = useState('');
  // '' all · 'none' not on any release · a release id
  const [releaseFilter, setReleaseFilter] = useState<'' | 'none' | number>('');
  const [audioOnly, setAudioOnly] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'rating', dir: -1 });

  const filtering =
    query.trim() !== '' ||
    artistFilter !== '' ||
    ratingFilter !== 'any' ||
    genreFilter !== '' ||
    releaseFilter !== '' ||
    audioOnly;

  const releaseTitle = useMemo(() => new Map(releases.map((r) => [r.id, r.title])), [releases]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortProjects(projects, sort).filter((p) => {
      if (audioOnly && !p.latest) return false;
      if (artistFilter !== '' && p.artist.id !== artistFilter) return false;
      if (ratingFilter === 'unrated' && p.rating !== 0) return false;
      if (typeof ratingFilter === 'number' && p.rating < ratingFilter) return false;
      if (genreFilter && p.genre !== genreFilter) return false;
      const on = p.releaseIds ?? [];
      if (releaseFilter === 'none' && on.length) return false;
      if (typeof releaseFilter === 'number' && !on.includes(releaseFilter)) return false;
      if (q) {
        const rel = on.map((id) => releaseTitle.get(id) ?? '').join(' ');
        const hay = `${p.canonicalId} ${p.workingName} ${p.genre} ${p.artist.code} ${p.artist.name} ${rel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, query, artistFilter, ratingFilter, genreFilter, releaseFilter, audioOnly, sort, releaseTitle]);

  function clickSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: FIRST_DIR[key] }));
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);

  /** Click toggles one row; Shift-click sets every row from the last click to this one to this row's new state. */
  function clickSelect(p: StudioProject, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(p.id);
      const a = anchor.current === null ? -1 : shown.findIndex((x) => x.id === anchor.current);
      const b = shown.findIndex((x) => x.id === p.id);
      if (shift && a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) (on ? next.add(shown[i].id) : next.delete(shown[i].id));
      } else if (on) next.add(p.id);
      else next.delete(p.id);
      return next;
    });
    anchor.current = p.id;
  }

  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.id));
  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of shown) (allShownSelected ? next.delete(p.id) : next.add(p.id));
      return next;
    });
  }

  // ── Writes ────────────────────────────────────────────────────────────────
  // API responses about sessions carry no `latest` or `releaseIds`; keep ours.
  function merge(updated: StudioProject[]) {
    const byId = new Map(updated.map((p) => [p.id, p]));
    setProjects((list) =>
      list.map((x) => {
        const u = byId.get(x.id);
        return u ? { ...u, latest: u.latest ?? x.latest, releaseIds: u.releaseIds ?? x.releaseIds } : x;
      }),
    );
  }

  async function patch(p: StudioProject, fields: Record<string, unknown>): Promise<boolean> {
    setError('');
    const r = await api<{ project: StudioProject }>(`/api/projects/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    if (r.ok) {
      merge([r.data.project]);
      return true;
    }
    setError(r.body.error || 'Could not save the change.');
    return false;
  }

  async function rate(p: StudioProject, rating: number) {
    merge([{ ...p, rating }]); // optimistic
    if (!(await patch(p, { rating }))) merge([p]);
  }

  async function bulk(fields: Record<string, unknown>): Promise<boolean> {
    setError('');
    // In the order they appear, so "add to release" keeps the list's order.
    const ids = shown.filter((p) => selected.has(p.id)).map((p) => p.id);
    const hidden = Array.from(selected).filter((id) => !ids.includes(id));
    const r = await api<{ projects: StudioProject[] }>('/api/projects/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [...ids, ...hidden], ...fields }),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not apply the change.');
      return false;
    }
    merge(r.data.projects);
    if (fields.releaseId) {
      const rid = Number(fields.releaseId);
      const all = new Set([...ids, ...hidden]);
      setProjects((list) =>
        list.map((p) =>
          all.has(p.id) && !(p.releaseIds ?? []).includes(rid) ? { ...p, releaseIds: [...(p.releaseIds ?? []), rid] } : p,
        ),
      );
      setReleases((list) =>
        list.map((rel) =>
          rel.id === rid
            ? { ...rel, trackCount: projects.filter((p) => all.has(p.id) || (p.releaseIds ?? []).includes(rid)).length }
            : rel,
        ),
      );
    }
    return true;
  }

  async function addGenre(name: string): Promise<string | null> {
    setError('');
    const r = await api<{ name: string; genres: string[] }>('/api/genres', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not add the genre.');
      return null;
    }
    setGenres(r.data.genres);
    return r.data.name;
  }

  async function newRelease(title: string): Promise<StudioRelease | null> {
    setError('');
    const r = await api<{ release: StudioRelease }>('/api/collections', {
      method: 'POST',
      body: JSON.stringify({ title, kind: 'lp' }),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not create the collection.');
      return null;
    }
    setReleases((list) => [...list, r.data.release]);
    return r.data.release;
  }

  // ── Player ────────────────────────────────────────────────────────────────
  // The site's one player (deck.ts) plays a session's current mix, with the
  // list as sorted and filtered as its queue; its bar sits at the foot of
  // every page. While this page is open the bar can rate the playing session.
  const deck = useDeck();
  const queue = useMemo(() => shown.map(itemOfProject).filter((x): x is PlayItem => x !== null), [shown]);
  const latest = useRef({ projects, rate });
  useEffect(() => {
    latest.current = { projects, rate };
  });
  useEffect(() => {
    setRater({
      ratingOf: (id) => projects.find((p) => p.id === id)?.rating ?? 0,
      rate: (id, n) => {
        const p = latest.current.projects.find((x) => x.id === id);
        if (p) void latest.current.rate(p, n);
      },
    });
  }, [projects]);
  useEffect(() => () => setRater(null), []);
  // Space with nothing loaded starts the list; once something plays, the bar has the keys.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.key !== ' ' || deckState().item || !queue.length || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName))) return;
      e.preventDefault();
      deckToggle(queue[0], queue);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queue]);

  const th = 'px-2 py-2 text-left text-[11px] font-normal uppercase tracking-wide text-muted';
  const SortHead = ({ k, children, className = '' }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={`${th} ${className}`} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => clickSort(k)} className={`hover:text-ink ${sort.key === k ? 'text-ink' : ''}`}>
        {children}
        <span className="ml-1 inline-block w-2">{sort.key === k ? (sort.dir === 1 ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  );

  return (
    <div>

      <div className="flex flex-wrap items-center gap-3">
        <NewProject
          artists={artists}
          defaultArtistId={defaultArtistId}
          onCreated={(p) => setProjects((list) => [{ ...p, latest: null, releaseIds: [] }, ...list])}
        />
        <Link href="/collections" className="t-body text-muted underline hover:text-ink">
          Releases ({releases.length})
        </Link>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="mb-3 mt-6 flex flex-wrap items-center gap-4 t-body">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ID, name, artist, collection…"
          className="w-full rounded border border-line bg-card px-3 py-1.5 outline-none focus:border-rust sm:w-64"
        />
        <FilterSelect
          label="Artist"
          value={String(artistFilter)}
          onChange={(v) => setArtistFilter(v === '' ? '' : Number(v))}
          options={[['', 'All'], ...artists.map((a) => [String(a.id), `${a.code} — ${a.name}`] as [string, string])]}
        />
        <FilterSelect
          label="Rating"
          value={String(ratingFilter)}
          onChange={(v) => setRatingFilter(v === 'any' || v === 'unrated' ? v : Number(v))}
          options={[
            ['any', 'Any'],
            ...Array.from({ length: RATING_MAX }, (_, i) => RATING_MAX - i).map(
              (n) => [String(n), '★'.repeat(n) + (n < RATING_MAX ? ' and up' : '')] as [string, string],
            ),
            ['unrated', 'Unrated'],
          ]}
        />
        <FilterSelect
          label="Genre"
          value={genreFilter}
          onChange={setGenreFilter}
          options={[['', 'All'], ...genres.map((g) => [g, g] as [string, string])]}
        />
        <FilterSelect
          label="Collection"
          value={String(releaseFilter)}
          onChange={(v) => setReleaseFilter(v === '' || v === 'none' ? v : Number(v))}
          options={[
            ['', 'All'],
            ...releases.map((r) => [String(r.id), r.title] as [string, string]),
            ['none', 'Not in a collection'],
          ]}
        />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} />
          <span className="text-muted">With audio</span>
        </label>
        {filtering && (
          <span className="flex items-baseline gap-2 text-[11px] text-muted">
            showing {shown.length} of {projects.length}
            <button
              onClick={() => {
                setQuery('');
                setArtistFilter('');
                setRatingFilter('any');
                setGenreFilter('');
                setReleaseFilter('');
                setAudioOnly(false);
              }}
              className={BUTTON}
            >
              clear
            </button>
          </span>
        )}
      </div>

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          artists={artists}
          genres={genres}
          releases={releases}
          onAddGenre={addGenre}
          onNewRelease={newRelease}
          onApply={bulk}
          onClear={() => setSelected(new Set())}
        />
      )}

      {error && <p className="mb-3 t-body text-rust">{error}</p>}

      {shown.length === 0 ? (
        <p className="rounded-lg border border-line bg-card px-4 py-6 t-body text-muted">
          {projects.length === 0 ? 'No projects yet.' : 'No projects match these filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full min-w-[900px] border-collapse t-body">
            <thead className="border-b border-line">
              <tr>
                <th className={`${th} w-8`}>
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={toggleAllShown}
                    aria-label={allShownSelected ? 'Deselect all shown' : 'Select all shown'}
                  />
                </th>
                <th className={`${th} w-9`} />
                <SortHead k="rating">Rating</SortHead>
                <SortHead k="artist">Artist</SortHead>
                <SortHead k="id">ID</SortHead>
                <SortHead k="name">Working name</SortHead>
                <SortHead k="genre">Genre</SortHead>
                <SortHead k="bpm" className="text-right">BPM</SortHead>
                <SortHead k="versions">Ver.</SortHead>
                <SortHead k="length" className="text-right">Length</SortHead>
                <th className={th}>Collections</th>
                <SortHead k="date">Project</SortHead>
                <SortHead k="upload">Uploaded</SortHead>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  selected={selected.has(p.id)}
                  onSelect={(shift) => clickSelect(p, shift)}
                  isCurrent={p.id === deck.item?.projectId}
                  playing={p.id === deck.item?.projectId && deck.playing}
                  onPlay={() => {
                    const it = itemOfProject(p);
                    if (it) deckToggle(it, queue);
                  }}
                  genres={genres}
                  releaseTitles={(p.releaseIds ?? []).map((id) => releaseTitle.get(id) ?? '').filter(Boolean)}
                  onAddGenre={addGenre}
                  onRate={(n) => rate(p, n)}
                  onPatch={(f) => patch(p, f)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}


      <p className="mt-3 text-[11px] text-muted">
        Click a column heading to sort, again to reverse. Shift-click checkboxes to select a range.
        {shown.some((p) => p.latest) && ' Keys: Space play/pause · N next · P previous · 1–5 rate the playing project · 0 clears.'}
      </p>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[14rem] rounded border border-line bg-card px-2 py-1 outline-none focus:border-rust"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const NEW_RELEASE = '__new__';

function BulkBar({
  count,
  artists,
  genres,
  releases,
  onAddGenre,
  onNewRelease,
  onApply,
  onClear,
}: {
  count: number;
  artists: StudioArtist[];
  genres: string[];
  releases: StudioRelease[];
  onAddGenre: (name: string) => Promise<string | null>;
  onNewRelease: (title: string) => Promise<StudioRelease | null>;
  onApply: (fields: Record<string, unknown>) => Promise<boolean>;
  onClear: () => void;
}) {
  const [bpm, setBpm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [newTitle, setNewTitle] = useState<string | null>(null);

  async function apply(fields: Record<string, unknown>, label: string) {
    setBusy(true);
    setDone('');
    const ok = await onApply(fields);
    setBusy(false);
    if (ok) setDone(`${label} set on ${count}.`);
  }

  const sel = 'rounded border border-line bg-card px-2 py-1 t-body outline-none focus:border-rust';

  return (
    <div className="sticky top-0 z-30 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-ink/30 bg-parchment px-3 py-2 t-body shadow-sm">
      <span className="font-medium">{count} selected</span>

      <label className="flex items-center gap-2">
        <span className="text-muted">Genre</span>
        <GenreSelect
          value=""
          genres={genres}
          onAddGenre={onAddGenre}
          onChange={(g) => apply({ genre: g }, g ? `Genre “${g}”` : 'No genre')}
        />
      </label>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ bpm }, bpm ? `BPM ${bpm}` : 'No BPM');
        }}
      >
        <span className="text-muted">BPM</span>
        <input
          value={bpm}
          onChange={(e) => setBpm(e.target.value)}
          inputMode="decimal"
          placeholder="—"
          className={`${sel} w-16`}
        />
        <button disabled={busy} className={BUTTON}>
          Set
        </button>
      </form>

      <label className="flex items-center gap-2">
        <span className="text-muted">Rating</span>
        <select
          value=""
          disabled={busy}
          onChange={(e) => e.target.value !== '' && apply({ rating: Number(e.target.value) }, 'Rating')}
          className={sel}
        >
          <option value="">—</option>
          {Array.from({ length: RATING_MAX + 1 }, (_, i) => RATING_MAX - i).map((n) => (
            <option key={n} value={n}>
              {n ? '★'.repeat(n) : 'Unrated'}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted">Artist</span>
        <select
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && apply({ artistId: Number(e.target.value) }, 'Artist')}
          className={sel}
        >
          <option value="">—</option>
          {artists.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted">Add to collection</span>
        {newTitle === null ? (
          <select
            value=""
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              if (v === NEW_RELEASE) setNewTitle('');
              else if (v) apply({ releaseId: Number(v) }, 'Collection');
            }}
            className={sel}
          >
            <option value="">—</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
            <option value={NEW_RELEASE}>+ New collection…</option>
          </select>
        ) : (
          <input
            autoFocus
            value={newTitle}
            placeholder="Collection title"
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Escape') setNewTitle(null);
              if (e.key === 'Enter' && newTitle.trim()) {
                const rel = await onNewRelease(newTitle.trim());
                setNewTitle(null);
                if (rel) apply({ releaseId: rel.id }, `Release “${rel.title}”`);
              }
            }}
            onBlur={() => setNewTitle(null)}
            className={`${sel} w-44`}
          />
        )}
      </label>

      {done && <span className="text-[11px] text-muted">{done}</span>}
      <button onClick={onClear} className={`ml-auto ${BUTTON}`}>
        Clear selection
      </button>
    </div>
  );
}

function ProjectRow({
  project: p,
  selected,
  onSelect,
  isCurrent,
  playing,
  onPlay,
  genres,
  releaseTitles,
  onAddGenre,
  onRate,
  onPatch,
}: {
  project: StudioProject;
  selected: boolean;
  onSelect: (shift: boolean) => void;
  isCurrent: boolean;
  playing: boolean;
  onPlay: () => void;
  genres: string[];
  releaseTitles: string[];
  onAddGenre: (name: string) => Promise<string | null>;
  onRate: (rating: number) => void;
  onPatch: (fields: Record<string, unknown>) => Promise<boolean>;
}) {
  const td = 'px-2 py-2 align-middle';
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <tr className={isCurrent ? 'bg-ink/5' : selected ? 'bg-ink/[0.03]' : undefined}>
      <td className={td}>
        <input
          type="checkbox"
          checked={selected}
          // onClick rather than onChange: the change event carries no Shift key.
          onClick={(e) => onSelect(e.shiftKey)}
          onChange={() => {}}
          aria-label={`Select ${p.canonicalId}`}
        />
      </td>
      <td className={td}>
        {p.latest ? (
          <button
            onClick={onPlay}
            aria-label={playing ? 'Pause' : `Play ${p.latest.label}`}
            title={`${playing ? 'Pause' : 'Play'} ${p.latest.label}`}
            className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] ${
              isCurrent ? 'border-ink bg-ink text-parchment' : 'border-line hover:border-ink'
            }`}
          >
            {playing ? '❚❚' : '▶'}
          </button>
        ) : null}
      </td>
      <td className={td}>
        <Stars rating={p.rating} onRate={onRate} />
      </td>
      <td className={`${td} text-[11px] font-medium tracking-[0.04em] text-muted`} title={p.artist.name}>
        {p.artist.code}
      </td>
      <td className={`${td} whitespace-nowrap`}>
        <Link
          href={`/projects/${p.id}`}
          className="font-mono underline decoration-muted/50 underline-offset-4 hover:decoration-ink"
          title="Open the project"
        >
          {p.canonicalId}
        </Link>
      </td>
      <td className={`${td} min-w-[12rem] max-w-[22rem]`}>
        <InlineEdit value={p.workingName} placeholder="untitled" label="Working name" onSave={(v) => onPatch({ workingName: v })} />
      </td>
      <td className={`${td} w-36 text-muted`}>
        <GenreSelect
          value={p.genre}
          genres={genres}
          onAddGenre={onAddGenre}
          onChange={(g) => onPatch({ genre: g })}
          className="w-full border-transparent bg-transparent hover:border-line"
        />
      </td>
      <td className={`${td} w-16 text-right tabular-nums text-muted`}>
        <InlineEdit
          value={p.bpm === null ? '' : String(p.bpm)}
          placeholder="—"
          label="BPM"
          inputMode="decimal"
          align="right"
          onSave={(v) => onPatch({ bpm: v })}
        />
      </td>
      <td className={`${td} text-[11px] tabular-nums text-muted`}>{p.latest ? p.latest.label : ''}</td>
      <td className={`${td} text-right text-[11px] tabular-nums text-muted`}>
        {p.latest ? formatDuration(p.latest.durationS) : ''}
      </td>
      <td className={`${td} max-w-[10rem] truncate text-[11px] text-muted`} title={releaseTitles.join(', ')}>
        {releaseTitles.join(', ')}
      </td>
      <td className={`${td} whitespace-nowrap text-[11px] text-muted`}>{date(p.createdAt)}</td>
      <td className={`${td} whitespace-nowrap text-[11px] text-muted`}>{p.latest ? date(p.latest.uploadedAt) : ''}</td>
    </tr>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { ReleaseKind, StudioArtist, StudioProject, StudioRelease, StudioShare } from '@/lib/studioTypes';
import { RELEASE_KIND_LABEL, RELEASE_KINDS, formatDuration, levelAtLeast } from '@/lib/studioTypes';
import { api, InlineEdit } from './controls';
import PlayerBar from './PlayerBar';
import Sharing from './Sharing';
import { usePlayer } from './usePlayer';

// One release: its details, its running order (each entry plays that
// session's newest mix, and the player runs straight through in order), and
// a search for adding sessions. Editing needs edit access; taking a track off,
// deleting, crediting an artist and sharing need ownership (REQUIREMENTS AC-5,
// AC-7). Sharing a collection lets the people it is shared with hear the
// owner's own tracks on it (AC-6).

export default function ReleaseDetail({
  initialRelease,
  initialTracks,
  artists,
  allSessions,
  initialShares,
}: {
  initialRelease: StudioRelease;
  initialTracks: StudioProject[];
  artists: StudioArtist[];
  allSessions: StudioProject[];
  initialShares: StudioShare[];
}) {
  const router = useRouter();
  const [release, setRelease] = useState(initialRelease);
  const canEdit = levelAtLeast(release.level, 'edit');
  const isOwner = release.level === 'owner';
  const [tracks, setTracks] = useState(initialTracks);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [armed, setArmed] = useState(false);

  const player = usePlayer(tracks, tracks);

  const total = tracks.reduce((s, p) => s + (p.latest?.durationS ?? 0), 0);

  const onRelease = new Set(tracks.map((t) => t.id));
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allSessions
      .filter((p) => !onRelease.has(p.id))
      .filter((p) => `${p.canonicalId} ${p.workingName} ${p.artist.code} ${p.genre}`.toLowerCase().includes(q))
      .slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, allSessions, tracks]);

  async function save(fields: Record<string, unknown>): Promise<boolean> {
    setError('');
    const r = await api<{ release: StudioRelease }>(`/api/collections/${release.id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not save the change.');
      return false;
    }
    setRelease(r.data.release);
    return true;
  }

  async function order(method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown>) {
    setError('');
    const r = await api<{ projects: StudioProject[] }>(`/api/collections/${release.id}/tracks`, {
      method,
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not update the running order.');
      return;
    }
    setTracks(r.data.projects);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= tracks.length) return;
    const next = [...tracks];
    [next[i], next[j]] = [next[j], next[i]];
    setTracks(next); // optimistic
    order('PUT', { projectIds: next.map((p) => p.id) });
  }

  async function remove() {
    const r = await api(`/api/collections/${release.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setError(r.body.error || 'Could not delete the collection.');
      return;
    }
    router.push('/collections');
  }

  const sel = 'rounded border border-line bg-card px-2 py-1 t-body outline-none focus:border-rust';

  return (
    <div className={`mt-4 ${player.current ? 'pb-28' : ''}`}>
      <audio {...player.audioProps} />

      {canEdit ? (
        <InlineEdit
          value={release.title}
          placeholder="Untitled collection"
          label="Title"
          textClass="t-title"
          onSave={(v) => save({ title: v })}
        />
      ) : (
        <h1 className="t-title">{release.title || 'Untitled collection'}</h1>
      )}
      {!isOwner && <p className="mt-1 text-[11px] text-muted">Shared by {release.ownerName}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3 t-body">
        <select
          value={release.kind}
          onChange={(e) => save({ kind: e.target.value as ReleaseKind })}
          disabled={!canEdit}
          className={sel}
          aria-label="Kind"
        >
          {RELEASE_KINDS.map((k) => (
            <option key={k} value={k}>
              {RELEASE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          value={release.artist?.id ?? ''}
          onChange={(e) => save({ artistId: e.target.value || null })}
          disabled={!isOwner}
          className={sel}
          aria-label="Artist"
        >
          <option value="">Various / undecided</option>
          {release.artist && !artists.some((a) => a.id === release.artist?.id) && (
            <option value={release.artist.id}>
              {release.artist.code} — {release.artist.name}
            </option>
          )}
          {artists.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
        <span className="flex items-center gap-1">
          <span className="text-muted">Year</span>
          <span className="w-16">
            {canEdit ? (
              <InlineEdit
                value={release.year === null ? '' : String(release.year)}
                placeholder="—"
                label="Year"
                inputMode="decimal"
                onSave={(v) => save({ year: v || null })}
              />
            ) : (
              release.year ?? '—'
            )}
          </span>
        </span>
        <span className="text-muted">
          {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          {total > 0 && ` · ${formatDuration(total)}`}
        </span>
        {tracks.some((t) => t.latest) && (
          <button onClick={() => player.toggle(tracks.find((t) => t.latest))} className="rounded bg-rust px-3 py-1 text-white">
            ▶ Play all
          </button>
        )}
      </div>

      {error && <p className="mt-3 t-body text-rust">{error}</p>}

      <ol className="mt-6 divide-y divide-line rounded-lg border border-line bg-card">
        {tracks.length === 0 && <li className="px-4 py-6 t-body text-muted">No tracks yet.</li>}
        {tracks.map((p, i) => {
          const isCurrent = p.id === player.currentId;
          return (
            <li key={p.id} className={`flex items-center gap-3 px-4 py-2 t-body ${isCurrent ? 'bg-ink/5' : ''}`}>
              <span className="w-6 text-right tabular-nums text-muted">{i + 1}</span>
              {p.latest ? (
                <button
                  onClick={() => player.toggle(p)}
                  aria-label={isCurrent && player.playing ? 'Pause' : 'Play'}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                    isCurrent ? 'border-ink bg-ink text-parchment' : 'border-line hover:border-ink'
                  }`}
                >
                  {isCurrent && player.playing ? '❚❚' : '▶'}
                </button>
              ) : (
                <span className="h-7 w-7 shrink-0" title="No reference track yet" />
              )}
              <span className="w-10 shrink-0 text-[11px] font-medium text-muted">{p.artist.code}</span>
              <Link href={`/projects/${p.id}`} className="w-28 shrink-0 font-mono hover:underline">
                {p.canonicalId}
              </Link>
              <span className="min-w-0 flex-1 truncate">{p.workingName || <span className="text-muted">untitled</span>}</span>
              <span className="text-[11px] tabular-nums text-muted">
                {p.latest ? `${p.latest.label} · ${formatDuration(p.latest.durationS)}` : 'no audio'}
              </span>
              {canEdit && (
              <span className="flex shrink-0 gap-1 text-muted">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="px-1 hover:text-ink disabled:opacity-30" aria-label="Move up">
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === tracks.length - 1}
                  className="px-1 hover:text-ink disabled:opacity-30"
                  aria-label="Move down"
                >
                  ↓
                </button>
                {isOwner && (
                  <button
                    onClick={() => order('DELETE', { projectId: p.id })}
                    className="px-1 hover:text-rust"
                    aria-label="Remove from collection"
                  >
                    ×
                  </button>
                )}
              </span>
              )}
            </li>
          );
        })}
      </ol>

      {canEdit && (
      <div className="mt-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Add a session: search by ID, name, artist or genre…"
          className="w-full rounded border border-line bg-card px-3 py-2 t-body outline-none focus:border-rust sm:w-96"
        />
        {matches.length > 0 && (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-card t-body sm:w-96">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => {
                    order('POST', { projectIds: [p.id] });
                    setSearch('');
                  }}
                  className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-ink/5"
                >
                  <span className="text-[11px] text-muted">{p.artist.code}</span>
                  <span className="font-mono">{p.canonicalId}</span>
                  <span className="truncate">{p.workingName}</span>
                  <span className="ml-auto text-[11px] text-muted">+ add</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {isOwner && <Sharing sharesUrl={`/api/projects/${release.id}/shares`} initialShares={initialShares} />}

      {isOwner && (
      <div className="mt-10 text-[11px]">
        {armed ? (
          <span className="flex gap-3">
            <button onClick={remove} className="text-rust underline">
              Confirm: delete this collection
            </button>
            <button onClick={() => setArmed(false)} className="text-muted hover:text-ink">
              cancel
            </button>
            <span className="text-muted">The sessions and their audio stay.</span>
          </span>
        ) : (
          <button onClick={() => setArmed(true)} className="text-muted hover:text-rust">
            Delete collection
          </button>
        )}
      </div>
      )}

      {player.current && (
        <PlayerBar
          project={player.current}
          playing={player.playing}
          time={player.time}
          duration={player.duration}
          autoAdvance={player.autoAdvance}
          onToggle={() => player.toggle()}
          onPrev={() => player.step(-1)}
          onNext={() => player.step(1)}
          onSeek={player.seek}
          onAutoAdvance={player.setAutoAdvance}
        />
      )}
    </div>
  );
}

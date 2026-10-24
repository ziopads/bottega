'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ReleaseKind, StudioArtist, StudioRelease } from '@/lib/studioTypes';
import { RELEASE_KIND_LABEL, RELEASE_KINDS } from '@/lib/studioTypes';
import { api } from './controls';
import { BUTTON_PRIMARY } from '@/app/_ui/styles';

// The viewer's collections, with a form to start a new one, then the
// collections others have shared with them (REQUIREMENTS AC-8). Sessions are
// added to a collection from its page, or in bulk from the sessions list.

export default function ReleaseList({
  initialReleases,
  artists,
  viewerId,
}: {
  initialReleases: StudioRelease[];
  artists: StudioArtist[];
  viewerId: string;
}) {
  const myArtists = artists.filter((a) => a.mine);
  const [releases, setReleases] = useState(initialReleases);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ReleaseKind>('lp');
  const [artistId, setArtistId] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await api<{ release: StudioRelease }>('/api/collections', {
      method: 'POST',
      body: JSON.stringify({ title, kind, artistId: artistId || null, year: year || null }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not create the collection.');
      return;
    }
    setReleases((list) => [r.data.release, ...list]);
    setTitle('');
    setYear('');
  }

  const field = 'rounded border border-line bg-parchment px-2 py-1.5 t-body outline-none focus:border-rust';

  return (
    <div>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-4 t-body">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Title</span>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} w-64`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as ReleaseKind)} className={field}>
            {RELEASE_KINDS.map((k) => (
              <option key={k} value={k}>
                {RELEASE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Artist</span>
          <select value={artistId} onChange={(e) => setArtistId(e.target.value)} className={field}>
            <option value="">Various / undecided</option>
            {myArtists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Year</span>
          <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" className={`${field} w-20`} />
        </label>
        <button disabled={busy || !title.trim()} className={BUTTON_PRIMARY}>
          {busy ? 'Creating…' : 'New collection'}
        </button>
      </form>
      {error && <p className="mt-3 t-body text-rust">{error}</p>}

      {releases.length === 0 ? (
        <p className="mt-6 t-body text-muted">No collections yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-card">
          {[...releases.filter((r) => r.ownerId === viewerId), ...releases.filter((r) => r.ownerId !== viewerId)].map((r) => (
            <li key={r.id}>
              <Link href={`/collections/${r.id}`} className="flex items-baseline gap-3 px-4 py-3 hover:bg-ink/5">
                <span className="t-lead">{r.title}</span>
                <span className="t-small text-muted">
                  {[RELEASE_KIND_LABEL[r.kind], r.artist?.code, r.year].filter(Boolean).join(' · ')}
                </span>
                <span className="ml-auto t-small text-muted">
                  {r.ownerId !== viewerId && `shared by ${r.ownerName} · `}
                  {r.trackCount} {r.trackCount === 1 ? 'track' : 'tracks'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ReleaseKind, StudioArtist, StudioRelease } from '@/lib/studioTypes';
import { RELEASE_KIND_LABEL, RELEASE_KINDS } from '@/lib/studioTypes';
import { api } from './controls';

// All releases, with a form to start a new one. Sessions are added to a
// release from its page, or in bulk from the sessions list.

export default function ReleaseList({
  initialReleases,
  artists,
}: {
  initialReleases: StudioRelease[];
  artists: StudioArtist[];
}) {
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
      setError(r.body.error || 'Could not create the release.');
      return;
    }
    setReleases((list) => [r.data.release, ...list]);
    setTitle('');
    setYear('');
  }

  const field = 'rounded-md border border-line bg-parchment px-2 py-1.5 text-sm outline-none focus:border-rust';

  return (
    <div>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-4 text-sm">
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
            {artists.map((a) => (
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
        <button disabled={busy || !title.trim()} className="rounded-md bg-rust px-4 py-1.5 text-white disabled:opacity-50">
          {busy ? 'Creating…' : 'New release'}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-rust">{error}</p>}

      {releases.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No releases yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-card">
          {releases.map((r) => (
            <li key={r.id}>
              <Link href={`/collections/${r.id}`} className="flex items-baseline gap-3 px-4 py-3 hover:bg-ink/5">
                <span className="font-serif text-lg">{r.title}</span>
                <span className="text-xs text-muted">
                  {[RELEASE_KIND_LABEL[r.kind], r.artist?.code, r.year].filter(Boolean).join(' · ')}
                </span>
                <span className="ml-auto text-xs text-muted">
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

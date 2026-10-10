'use client';

import { useState } from 'react';
import type { StudioArtist, StudioProject } from '@/lib/studioTypes';
import { todayCanonicalId } from '@/lib/studioTypes';
import { api } from './controls';

// The "New session" form on the sessions list.

export default function NewProject({
  artists,
  defaultArtistId,
  onCreated,
}: {
  artists: StudioArtist[];
  defaultArtistId: number | null;
  onCreated: (p: StudioProject) => void;
}) {
  const [open, setOpen] = useState(false);
  const [artistId, setArtistId] = useState<number | ''>(defaultArtistId ?? '');
  const [canonicalId, setCanonicalId] = useState('');
  const [workingName, setWorkingName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);

  function start() {
    // Today's date is taken when the form opens, in the viewer's own time zone,
    // rather than at render, where the server's clock (UTC) would decide it.
    setCanonicalId(todayCanonicalId());
    setWorkingName('');
    setError('');
    setSuggestion(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuggestion(null);
    const r = await api<{ project: StudioProject }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ artistId: artistId === '' ? null : artistId, canonicalId, workingName }),
    });
    setBusy(false);
    if (r.ok) {
      onCreated(r.data.project);
      setOpen(false);
      return;
    }
    setError(r.body.error || 'Could not create the project.');
    if (r.status === 409 && r.body.suggestion) setSuggestion(r.body.suggestion);
  }

  if (!open) {
    return (
      <button onClick={start} className="rounded-md bg-rust px-4 py-2 text-sm text-white">
        New session
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Artist</span>
          <select
            required
            value={artistId}
            onChange={(e) => setArtistId(e.target.value === '' ? '' : Number(e.target.value))}
            className="rounded-md border border-line bg-parchment px-2 py-2 outline-none focus:border-rust"
          >
            <option value="" disabled>
              Choose…
            </option>
            {artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Canonical ID</span>
          <input
            required
            value={canonicalId}
            onChange={(e) => setCanonicalId(e.target.value)}
            className="w-36 rounded-md border border-line bg-parchment px-2 py-2 font-mono outline-none focus:border-rust"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Working name</span>
          <input
            value={workingName}
            onChange={(e) => setWorkingName(e.target.value)}
            placeholder="optional"
            className="rounded-md border border-line bg-parchment px-2 py-2 outline-none focus:border-rust"
          />
        </label>
      </div>

      <p className="mt-2 text-xs text-muted">
        The canonical ID must match the project&rsquo;s Ableton folder name. It cannot be changed after the project is
        created.
      </p>

      {error && (
        <p className="mt-3 text-sm text-rust">
          {error}{' '}
          {suggestion && (
            <button
              type="button"
              onClick={() => {
                setCanonicalId(suggestion);
                setError('');
                setSuggestion(null);
              }}
              className="underline"
            >
              Use “{suggestion}”
            </button>
          )}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button disabled={busy} className="rounded-md bg-rust px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy ? 'Creating…' : 'Create session'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

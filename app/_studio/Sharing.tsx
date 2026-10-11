'use client';

import { useState } from 'react';

import { SHARE_LEVEL_LABEL, SHARE_LEVELS, type ShareLevel, type StudioShare } from '@/lib/studioTypes';
import { api } from './controls';

// Who a project is shared with, for its owner (REQUIREMENTS AC-5). Sharing is
// by the other person's email; they need an approved account first. Every
// grant, change and revocation is written to the access log by the database.

export default function Sharing({
  sharesUrl,
  initialShares,
  note,
}: {
  /** The item's shares endpoint, e.g. /api/projects/7/shares or /api/gear/3/shares. */
  sharesUrl: string;
  initialShares: StudioShare[];
  /** What a share shows, when it is not everything. */
  note?: string;
}) {
  const [shares, setShares] = useState(initialShares);
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<ShareLevel>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    const r = await api<{ share: StudioShare }>(sharesUrl, {
      method: 'POST',
      body: JSON.stringify({ email, level }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not share.');
      return;
    }
    setShares((list) => [...list, r.data.share]);
    setEmail('');
  }

  async function change(s: StudioShare, next: ShareLevel) {
    setError('');
    const r = await api<{ share: StudioShare }>(`/api/shares/${s.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ level: next }),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not change the level.');
      return;
    }
    setShares((list) => list.map((x) => (x.id === s.id ? r.data.share : x)));
  }

  async function revoke(s: StudioShare) {
    setError('');
    const r = await api(`/api/shares/${s.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setError(r.body.error || 'Could not stop sharing.');
      return;
    }
    setShares((list) => list.filter((x) => x.id !== s.id));
  }

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Shared with</h2>
      {note && <p className="mb-3 text-xs text-muted">{note}</p>}
      {shares.length === 0 ? (
        <p className="text-sm text-muted">Only you can see this.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {shares.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">{s.granteeName}</span>
              <select
                value={s.level}
                onChange={(e) => change(s, e.target.value as ShareLevel)}
                aria-label={`Access for ${s.granteeName}`}
                className="rounded-md border border-line bg-card px-2 py-1 outline-none focus:border-rust"
              >
                {SHARE_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {SHARE_LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
              <button onClick={() => revoke(s)} className="text-xs text-muted hover:text-rust">
                Stop sharing
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their@email"
          aria-label="Email of the person to share with"
          className="w-64 rounded-md border border-line bg-card px-2 py-1 outline-none focus:border-rust"
        />
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as ShareLevel)}
          aria-label="Access to give"
          className="rounded-md border border-line bg-card px-2 py-1 outline-none focus:border-rust"
        >
          {SHARE_LEVELS.map((l) => (
            <option key={l} value={l}>
              {SHARE_LEVEL_LABEL[l]}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !email.trim()}
          className="rounded-md border border-line px-3 py-1 hover:border-ink disabled:opacity-50"
        >
          {busy ? 'Sharing…' : 'Share'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-rust">{error}</p>}
    </section>
  );
}

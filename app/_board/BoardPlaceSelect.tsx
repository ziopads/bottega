'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import type { BoardPlace } from '@/lib/boardTypes';

// A project's place on the person's own board, changed from wherever the
// project is shown: the Projects list and the project's own page
// (REQUIREMENTS W-21; plan of 24 October). Rotation full: the board's own
// message, shown beside it.

export default function BoardPlaceSelect({ projectId, initial, compact = false }: { projectId: number; initial: BoardPlace | null; compact?: boolean }) {
  const [place, setPlace] = useState<BoardPlace | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(next: BoardPlace | null) {
    setError('');
    setBusy(true);
    const r = await api('/api/board', {
      method: 'POST',
      body: JSON.stringify(next ? { op: 'place', projectId, place: next } : { op: 'remove', projectId }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.body?.error || 'That did not go through.');
      return;
    }
    setPlace(next);
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={place ?? ''}
        disabled={busy}
        onChange={(e) => change(e.target.value === 'backlog' || e.target.value === 'rotation' ? e.target.value : null)}
        aria-label="Place on my board"
        title="Your board"
        className={`rounded border bg-card px-1 py-0 text-[11px] outline-none focus:border-rust ${
          place ? 'border-ink/40 text-ink' : 'border-line text-muted'
        } ${compact ? '' : 't-body'}`}
      >
        <option value="">{compact ? '—' : 'Not on my board'}</option>
        <option value="backlog">{compact ? 'Backlog' : 'Board · backlog'}</option>
        <option value="rotation">{compact ? 'Rotation' : 'Board · in rotation'}</option>
      </select>
      {error && <span className="text-[11px] text-rust">{error}</span>}
    </span>
  );
}

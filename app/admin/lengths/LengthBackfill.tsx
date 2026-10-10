'use client';

import { useState } from 'react';

type Item = { id: number; label: string };
type Outcome = 'filled' | 'failed';

/** Reads one file's duration through a metadata-only load. Null if the browser can't tell. */
function measure(id: number): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const done = (d: number | null) => {
      audio.removeAttribute('src');
      audio.load();
      resolve(d);
    };
    const timer = setTimeout(() => done(null), 20_000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };
    audio.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    audio.src = `/api/tracks/${id}/audio`;
  });
}

export default function LengthBackfill({ items }: { items: Item[] }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Record<number, Outcome>>({});

  async function run() {
    setRunning(true);
    // One at a time: each load fetches only the file's opening bytes, but a
    // few hundred at once would still be a burst against R2 for no gain.
    for (const item of items) {
      if (done[item.id] === 'filled') continue;
      const d = await measure(item.id);
      let ok = false;
      if (d !== null) {
        const res = await fetch(`/api/audio/${item.id}/duration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ durationS: d }),
        });
        ok = res.ok;
      }
      setDone((prev) => ({ ...prev, [item.id]: ok ? 'filled' : 'failed' }));
    }
    setRunning(false);
  }

  const filled = Object.values(done).filter((o) => o === 'filled').length;
  const failed = items.filter((i) => done[i.id] === 'failed');

  return (
    <div className="space-y-3 text-sm">
      <button
        onClick={run}
        disabled={running}
        className="rounded-md border border-line px-3 py-1 hover:border-ink disabled:opacity-50"
      >
        {running ? `Measuring… ${Object.keys(done).length} of ${items.length}` : 'Measure and save'}
      </button>
      {Object.keys(done).length > 0 && (
        <p className="text-muted">
          {filled} filled{failed.length ? `, ${failed.length} could not be read` : ''}.
        </p>
      )}
      {failed.length > 0 && (
        <ul className="list-disc pl-5 text-muted">
          {failed.map((i) => (
            <li key={i.id}>{i.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

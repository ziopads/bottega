'use client';

import { useState } from 'react';

import { measureAndStore } from '@/lib/peaks';
import { BUTTON } from '@/app/_ui/styles';

// Measures the waveform of every mix and reference uploaded before
// waveforms existed (REQUIREMENTS S-10). Each file is downloaded once through
// its signed link and decoded here; the audio bucket's CORS rule must allow
// GET from this site for the download to be readable.

type Item = { id: number; label: string };
type Outcome = 'stored' | 'failed';

export default function WaveformBackfill({ items }: { items: Item[] }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Record<number, Outcome>>({});

  async function run() {
    setRunning(true);
    // One at a time: each is a full download and a decode in memory.
    for (const item of items) {
      if (done[item.id] === 'stored') continue;
      let ok = false;
      try {
        const res = await fetch(`/api/tracks/${item.id}/audio`);
        if (res.ok) ok = (await measureAndStore(item.id, await res.arrayBuffer())) !== null;
      } catch {
        ok = false;
      }
      setDone((prev) => ({ ...prev, [item.id]: ok ? 'stored' : 'failed' }));
    }
    setRunning(false);
  }

  const stored = Object.values(done).filter((o) => o === 'stored').length;
  const failed = items.filter((i) => done[i.id] === 'failed');

  return (
    <div className="t-body space-y-3">
      <button onClick={run} disabled={running} className={BUTTON}>
        {running ? `Measuring… ${Object.keys(done).length} of ${items.length}` : 'Measure waveforms'}
      </button>
      {Object.keys(done).length > 0 && (
        <p className="text-muted">
          {stored} stored{failed.length ? `, ${failed.length} could not be read` : ''}.
        </p>
      )}
      {failed.length > 0 && (
        <>
          <p className="text-muted">
            If every one failed, the audio bucket probably does not allow GET from this site yet (its CORS rule).
          </p>
          <ul className="list-disc pl-5 text-muted">
            {failed.map((i) => (
              <li key={i.id}>{i.label}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import type { Connection } from '@/lib/connections';

import When from './When';

// Claude and other connector clients this account has authorized, each with
// a way to end its access (REQUIREMENTS M-1, AC-11).

export default function ConnectedApps({ initial }: { initial: Connection[] }) {
  const [list, setList] = useState(initial);
  const [error, setError] = useState('');

  async function revoke(clientId: string) {
    setError('');
    const r = await api('/api/account/connections', { method: 'DELETE', body: JSON.stringify({ clientId }) });
    if (!r.ok) {
      setError(r.body.error || 'Could not revoke access.');
      return;
    }
    setList((l) => l.filter((c) => c.clientId !== clientId));
  }

  return (
    <div className="t-body">
      {error && <p className="mb-2 text-rust">{error}</p>}
      {list.length === 0 ? (
        <p className="text-muted">
          None. To connect Claude, add a custom connector in Claude with the address{' '}
          <span className="t-num text-ink">https://studio.sirsinate.com/api/mcp</span> and sign in when asked.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((c) => (
            <li key={c.clientId} className="flex items-baseline gap-3 py-1.5">
              <span className="min-w-0 flex-1" title={c.clientId}>
                {c.host}
              </span>
              <span className="text-[11px] text-muted">
                since <When iso={c.connectedAt} day />
              </span>
              <button onClick={() => revoke(c.clientId)} className="text-muted hover:text-rust">
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

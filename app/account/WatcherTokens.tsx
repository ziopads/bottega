'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';
import type { PersonalToken, WatcherReport } from '@/lib/tokens';

import { FIELD, formatWhen } from './parts';

// Account › Security › Mac watcher (REQUIREMENTS AC-15, A-9; db/026): the
// personal access tokens the watcher signs in with, each with its last use
// and its watcher's last report, including the folders it found no project
// for. A new token's secret is shown once, with the command that stores it.

type Data = { tokens: PersonalToken[]; reports: WatcherReport[] };

export default function WatcherTokens({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [name, setName] = useState('Studio Mac');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(body: unknown) {
    setError('');
    setBusy(true);
    const r = await api<Data & { secret?: string }>('/api/account/tokens', { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'That did not go through.');
      return;
    }
    setData({ tokens: r.data.tokens, reports: r.data.reports });
    if (r.data.secret) setSecret(r.data.secret);
  }

  const live = data.tokens.filter((t) => !t.revokedAt);
  const reportOf = (id: number) => data.reports.find((r) => r.tokenId === id);

  return (
    <div className="t-body space-y-3">
      <p className="text-muted">
        The watcher runs on your Mac, notices each set Live saves in your sessions folder, and sends it here with the folder&rsquo;s file list, as you.
        It signs in with a token made here. Setting it up: <span className="font-mono text-[12px]">docs/watcher.md</span> in the repository.
      </p>
      {error && <p className="text-rust">{error}</p>}
      {secret && (
        <div className="rounded border border-ink p-3">
          <p className="font-medium">Your new token. Copy it now: it is not shown again.</p>
          <p className="mt-1 select-all break-all rounded bg-ink/5 px-2 py-1 font-mono text-[12px]">{secret}</p>
          <p className="mt-2 text-[11px] text-muted">The watcher&rsquo;s setup asks for it and keeps it in your Mac&rsquo;s keychain.</p>
          <button onClick={() => setSecret(null)} className={`mt-2 ${BUTTON}`}>
            Done
          </button>
        </div>
      )}
      {live.length === 0 ? (
        <p className="text-muted">No tokens yet.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {live.map((t) => {
            const r = reportOf(t.id);
            return (
              <li key={t.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{t.name}</span>
                  <span className="font-mono text-[11px] text-muted">{t.prefix}…</span>
                  <span className="text-[11px] text-muted">
                    made {formatWhen(t.createdAt)} · {t.lastUsedAt ? `last used ${formatWhen(t.lastUsedAt)}` : 'never used'}
                  </span>
                  <button
                    onClick={() => confirm(`Revoke “${t.name}”? A watcher using it stops sending sets until it has a new token.`) && post({ op: 'revoke', id: t.id })}
                    disabled={busy}
                    className={`ml-auto ${BUTTON_DANGER}`}
                  >
                    Revoke
                  </button>
                </div>
                {r && (
                  <div className="text-[12px] text-muted">
                    Watcher {r.version} on {r.host || 'a Mac'} · last heard {formatWhen(r.reportedAt)} · watching <span className="font-mono">{r.root}</span>
                    {r.pending > 0 && <span className="text-ink"> · {r.pending} {r.pending === 1 ? 'set waits' : 'sets wait'} to be sent</span>}
                    {r.unmatched.length > 0 && (
                      <div className="mt-1">
                        <span className="text-ink">Folders with no project:</span> {r.unmatched.join(' · ')}.{' '}
                        Make the project (its canonical id is the date at the start of the folder name), or drop the folder once on the project&rsquo;s
                        State tab, and the watcher picks it up.
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void post({ op: 'create', name });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Token name" className={FIELD} />
        <button type="submit" disabled={busy || !name.trim()} className={BUTTON_PRIMARY}>
          Make a token
        </button>
      </form>
    </div>
  );
}

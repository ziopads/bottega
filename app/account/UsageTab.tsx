'use client';

import Link from 'next/link';
import { useState } from 'react';

import { DetailGrid, Section } from '@/app/_ui/layout';
import type { Allowance } from '@/lib/documentTypes';
import { formatBytes } from '@/lib/studioTypes';
import { USAGE_LABEL, type UsageFile, type UsageKind, type UsageRow } from '@/lib/usage';
import { BUTTON } from '@/app/_ui/styles';

// Usage (REQUIREMENTS O-7, K-10): storage against the allowance, by kind.
// Each kind opens to its largest files, ten at a time, each linked to where
// it lives, so the files worth removing are easy to find.

function Meter({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) return null;
  const share = limit > 0 ? Math.min(1, used / limit) : 1;
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-line" aria-hidden>
      <div className={`h-full ${share > 0.9 ? 'bg-rust' : 'bg-ink/70'}`} style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

type Loaded = { files: UsageFile[]; more: boolean; loading: boolean; error: string };

export default function UsageTab({
  usage,
  allowance,
  children,
}: {
  usage: UsageRow[];
  allowance: Allowance | null;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState<Partial<Record<UsageKind, boolean>>>({});
  const [loaded, setLoaded] = useState<Partial<Record<UsageKind, Loaded>>>({});

  const totalFiles = usage.reduce((n, u) => n + u.files, 0);
  const stored = allowance?.storageUsed ?? usage.reduce((n, u) => n + u.bytes, 0);

  async function load(kind: UsageKind, offset: number) {
    setLoaded((l) => ({ ...l, [kind]: { files: l[kind]?.files ?? [], more: false, loading: true, error: '' } }));
    const res = await fetch(`/api/account/usage?kind=${encodeURIComponent(kind)}&offset=${offset}`);
    const body = await res.json().catch(() => ({}));
    setLoaded((l) => {
      const before = offset === 0 ? [] : (l[kind]?.files ?? []);
      return res.ok
        ? { ...l, [kind]: { files: [...before, ...(body.files as UsageFile[])], more: body.more === true, loading: false, error: '' } }
        : { ...l, [kind]: { files: before, more: false, loading: false, error: body.error || 'Could not load the files.' } };
    });
  }

  function toggle(kind: UsageKind) {
    const next = !open[kind];
    setOpen((o) => ({ ...o, [kind]: next }));
    if (next && !loaded[kind]) void load(kind, 0);
  }

  const main = (
    <>
      <Section label="Storage">
        <div className="t-body">
          <div className="flex items-baseline justify-between">
            <span className="t-lead">{formatBytes(stored) || '0 KB'}</span>
            <span className="text-muted">
              {allowance?.storageBytes != null ? `of ${formatBytes(allowance.storageBytes)}` : 'no limit'} · {totalFiles}{' '}
              {totalFiles === 1 ? 'file' : 'files'}
            </span>
          </div>
          <Meter used={stored} limit={allowance?.storageBytes ?? null} />
        </div>

        <ul className="t-body mt-4 divide-y divide-line border-y border-line">
          {usage.map((u) => {
            const isOpen = !!open[u.kind];
            const l = loaded[u.kind];
            return (
              <li key={u.kind}>
                <button
                  type="button"
                  onClick={() => toggle(u.kind)}
                  disabled={u.files === 0}
                  aria-expanded={isOpen}
                  className="flex w-full items-baseline gap-2 py-1.5 text-left hover:text-ink disabled:cursor-default"
                >
                  <span className={`w-3 text-[10px] text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} aria-hidden>
                    {u.files > 0 ? '▶' : ''}
                  </span>
                  <span className="flex-1">{USAGE_LABEL[u.kind]}</span>
                  <span className="t-num text-muted">
                    {u.files} {u.files === 1 ? 'file' : 'files'}
                  </span>
                  <span className="t-num w-24 text-right">{u.bytes ? formatBytes(u.bytes) : '—'}</span>
                </button>
                {isOpen && (
                  <div className="pb-2 pl-5">
                    {l?.error && <p className="text-rust">{l.error}</p>}
                    {l && l.files.length > 0 && (
                      <ul className="divide-y divide-line/60">
                        {l.files.map((f) => (
                          <li key={f.id} className="flex items-baseline gap-2 py-1">
                            <span className="min-w-0 flex-1 truncate" title={f.name}>
                              {f.name}
                            </span>
                            <Link href={f.href} className="min-w-0 max-w-[45%] truncate text-[11px] text-muted hover:text-ink" title={f.where}>
                              {f.where}
                            </Link>
                            <span className="t-num w-24 shrink-0 text-right">{f.bytes ? formatBytes(f.bytes) : '—'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {l?.loading && <p className="py-1 text-muted">Loading…</p>}
                    {l && !l.loading && l.more && (
                      <button onClick={() => load(u.kind, l.files.length)} className={BUTTON}>
                        Show more
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] text-muted">
          Largest first. Files count against the owner of the session or unit they belong to, whoever uploaded them.
        </p>
      </Section>
      {children}
    </>
  );

  const aside = allowance && (
    <Section label="Processing">
      <div className="t-body">
        <div className="flex items-baseline justify-between">
          <span>Pages this month</span>
          <span className="t-num text-muted">
            {allowance.pagesUsed.toLocaleString()}
            {allowance.pagesPerMonth !== null ? ` of ${allowance.pagesPerMonth.toLocaleString()}` : ' (no limit)'}
          </span>
        </div>
        <Meter used={allowance.pagesUsed} limit={allowance.pagesPerMonth} />
        {allowance.maxDocumentPages !== null && (
          <p className="mt-2 text-[11px] text-muted">Documents can be up to {allowance.maxDocumentPages.toLocaleString()} pages.</p>
        )}
        <p className="mt-2 text-[11px] text-muted">Pages read from documents so they can be searched. The count starts again at the beginning of each month (UTC).</p>
      </div>
    </Section>
  );

  return <DetailGrid main={main} aside={aside || undefined} />;
}

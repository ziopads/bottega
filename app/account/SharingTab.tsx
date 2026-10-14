'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { DetailGrid, Section } from '@/app/_ui/layout';
import type { AccountShare, ShareKind } from '@/lib/account';
import { SHARE_LEVELS, type ShareLevel } from '@/lib/studioTypes';

import { FIELD } from './parts';
import When from './When';
import { BUTTON_SMALL_DANGER } from '@/app/_ui/styles';

// Sharing (REQUIREMENTS AC-5, AC-12): every share this account has granted,
// across sessions, gear and documents, grouped by item, to change or revoke in
// one place; and what others have shared with it. Each item's own page shares
// it with someone new.

const KIND_LABEL: Record<ShareKind, string> = { project: 'Sessions', gear: 'Gear', document: 'Documents' };
const KINDS: ShareKind[] = ['project', 'gear', 'document'];

const LEVEL_WORD: Record<ShareLevel, string> = { view: 'view', contribute: 'contribute', edit: 'edit' };

export default function SharingTab({ initialOutgoing, incoming }: { initialOutgoing: AccountShare[]; incoming: AccountShare[] }) {
  const [outgoing, setOutgoing] = useState(initialOutgoing);
  const [error, setError] = useState('');

  // Kind, then item, then the people it is shared with.
  const groups = useMemo(() => {
    return KINDS.map((kind) => {
      const items = new Map<number, { label: string; href: string; shares: AccountShare[] }>();
      for (const s of outgoing.filter((x) => x.kind === kind)) {
        const item = items.get(s.itemId) ?? { label: s.itemLabel, href: s.href, shares: [] };
        item.shares.push(s);
        items.set(s.itemId, item);
      }
      return { kind, items: Array.from(items, ([id, v]) => ({ id, ...v })) };
    }).filter((g) => g.items.length > 0);
  }, [outgoing]);

  async function change(s: AccountShare, level: ShareLevel) {
    setError('');
    const r = await api(`/api/shares/${s.id}`, { method: 'PATCH', body: JSON.stringify({ level }) });
    if (!r.ok) {
      setError(r.body.error || 'Could not change the share.');
      return;
    }
    setOutgoing((l) => l.map((x) => (x.id === s.id ? { ...x, level } : x)));
  }

  async function revoke(s: AccountShare) {
    setError('');
    if (!window.confirm(`Stop sharing “${s.itemLabel}” with ${s.personName}?`)) return;
    const r = await api(`/api/shares/${s.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setError(r.body.error || 'Could not revoke the share.');
      return;
    }
    setOutgoing((l) => l.filter((x) => x.id !== s.id));
  }

  const main = (
    <Section label={`Shared by you · ${outgoing.length}`}>
      {error && <p className="t-body mb-2 text-rust">{error}</p>}
      {groups.length === 0 ? (
        <p className="t-body text-muted">You have not shared anything. Share a session or a unit from its own page.</p>
      ) : (
        <div className="t-body space-y-5">
          {groups.map((g) => (
            <div key={g.kind}>
              <h3 className="t-label mb-1">{KIND_LABEL[g.kind]}</h3>
              <ul className="divide-y divide-line border-y border-line">
                {g.items.map((item) => (
                  <li key={item.id} className="py-1.5">
                    <Link href={item.href} className="font-medium hover:underline">
                      {item.label}
                    </Link>
                    <ul className="mt-1 space-y-1">
                      {item.shares.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-3">
                          <span className="min-w-0 flex-1">{s.personName}</span>
                          {/* Document shares have no controls yet: no page shares a document. */}
                          {s.kind === 'document' ? (
                            <span className="text-muted">{LEVEL_WORD[s.level]}</span>
                          ) : (
                            <>
                              <select
                                value={s.level}
                                onChange={(e) => change(s, e.target.value as ShareLevel)}
                                aria-label={`Access for ${s.personName}`}
                                className={FIELD}
                              >
                                {SHARE_LEVELS.map((lv) => (
                                  <option key={lv} value={lv}>
                                    {LEVEL_WORD[lv]}
                                  </option>
                                ))}
                              </select>
                              <button onClick={() => revoke(s)} className={BUTTON_SMALL_DANGER}>
                                Revoke
                              </button>
                            </>
                          )}
                          <span className="w-full text-[11px] text-muted sm:w-auto">
                            since <When iso={s.grantedAt} day />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );

  const aside = (
    <>
      <Section label={`Shared with you · ${incoming.length}`}>
        {incoming.length === 0 ? (
          <p className="t-body text-muted">Nothing yet.</p>
        ) : (
          <ul className="t-body divide-y divide-line">
            {incoming.map((s) => (
              <li key={s.id} className="py-1.5">
                <Link href={s.href} className="hover:underline">
                  {s.itemLabel}
                </Link>
                <div className="text-[11px] text-muted">
                  {s.personName} · {LEVEL_WORD[s.level]}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section label="Levels">
        <dl className="t-body space-y-1 text-muted">
          <div>
            <dt className="inline font-medium text-ink">view</dt> <dd className="inline">listen, download, read notes</dd>
          </div>
          <div>
            <dt className="inline font-medium text-ink">contribute</dt> <dd className="inline">view, and upload and add notes</dd>
          </div>
          <div>
            <dt className="inline font-medium text-ink">edit</dt> <dd className="inline">contribute, and change its details</dd>
          </div>
        </dl>
      </Section>
    </>
  );

  return <DetailGrid main={main} aside={aside} />;
}

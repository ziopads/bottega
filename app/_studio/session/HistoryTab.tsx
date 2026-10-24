'use client';

import { useMemo } from 'react';

import { formatWhen } from '@/app/_studio/Notes';
import { DetailGrid, Section } from '@/app/_ui/layout';
import type { StudioName, StudioReference, StudioTrack } from '@/lib/studioTypes';

// The History tab (REQUIREMENTS S-11): what happened to the session, newest
// first: versions and references uploaded, names changed. Notes are on the
// Notes tab.

type Event = { at: string; key: string; text: string; who: string };

export default function HistoryTab({
  tracks,
  references,
  names,
}: {
  tracks: StudioTrack[];
  references: StudioReference[];
  names: StudioName[];
}) {
  const events = useMemo<Event[]>(() => {
    const list: Event[] = [];
    for (const t of tracks)
      list.push({ at: t.uploadedAt, key: `t${t.id}`, text: `${t.label} uploaded · ${t.originalFilename}`, who: t.uploadedByName });
    for (const r of references)
      list.push({ at: r.uploadedAt, key: `r${r.id}`, text: `Reference added · ${r.credit || r.originalFilename}`, who: r.uploadedByName });
    for (const [i, n] of names.entries()) list.push({ at: n.setAt, key: `n${i}`, text: `Named “${n.name}”`, who: n.setByName });
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [tracks, references, names]);

  return (
    <DetailGrid
      main={
        <Section label={`History · ${events.length}`}>
          {events.length === 0 ? (
            <p className="t-body text-muted">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {events.map((e) => (
                <li key={e.key} className="t-body flex items-baseline gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate" title={e.text}>
                    {e.text}
                  </span>
                  <span className="shrink-0 t-small text-muted">
                    {e.who} · {formatWhen(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      }
    />
  );
}

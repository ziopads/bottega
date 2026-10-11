'use client';

import { useMemo, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { formatWhen, NoteComposer, NoteItem } from '@/app/_studio/Notes';
import { DetailGrid, Section } from '@/app/_ui/layout';
import type { StudioName, StudioNote, StudioReference, StudioTrack } from '@/lib/studioTypes';

// The Notes tab (REQUIREMENTS S-4, S-13): everything said and done on the
// session, newest first. Notes of every kind (on a mix, at a moment, on the
// whole session) and the events around them: versions and references
// uploaded, names changed. Filters beside it.

type Entry =
  | { kind: 'note'; at: string; note: StudioNote }
  | { kind: 'event'; at: string; key: string; text: string; who: string };

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function HistoryTab({
  projectId,
  tracks,
  references,
  names,
  notes,
  setNotes,
  viewerId,
  canContribute,
  canDelete,
}: {
  projectId: number;
  tracks: StudioTrack[];
  references: StudioReference[];
  names: StudioName[];
  notes: StudioNote[];
  setNotes: React.Dispatch<React.SetStateAction<StudioNote[]>>;
  viewerId: string;
  canContribute: boolean;
  canDelete: boolean;
}) {
  const [show, setShow] = useState<'all' | 'notes' | 'events'>('all');
  const [person, setPerson] = useState('');
  const [version, setVersion] = useState<'all' | 'session' | number>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = notes.map((n) => ({ kind: 'note', at: n.createdAt, note: n }));
    for (const t of tracks)
      list.push({ kind: 'event', at: t.uploadedAt, key: `t${t.id}`, text: `v${t.version} uploaded · ${t.originalFilename}`, who: t.uploadedByName });
    for (const r of references)
      list.push({ kind: 'event', at: r.uploadedAt, key: `r${r.id}`, text: `Reference added · ${r.credit || r.originalFilename}`, who: r.uploadedByName });
    for (const [i, n] of names.entries())
      list.push({ kind: 'event', at: n.setAt, key: `n${i}`, text: `Named “${n.name}”`, who: n.setByName });
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [notes, tracks, references, names]);

  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of notes) seen.set(n.authorId ?? '', n.authorName);
    return Array.from(seen, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [notes]);

  const shown = entries.filter((e) => {
    if (show === 'notes' && e.kind !== 'note') return false;
    if (show === 'events' && e.kind !== 'event') return false;
    if (e.kind === 'note') {
      if (person && (e.note.authorId ?? '') !== person) return false;
      if (version === 'session' && e.note.trackId !== null) return false;
      if (typeof version === 'number' && e.note.trackId !== version) return false;
    } else if (person || version !== 'all') return false;
    const day = localDay(e.at);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  const filtering = show !== 'all' || person !== '' || version !== 'all' || from !== '' || to !== '';

  const main = (
    <>
      {canContribute && (
        <Section label="New note">
          <NoteComposer projectId={projectId} tracks={tracks} onAdded={(n) => setNotes((l) => [n, ...l])} />
        </Section>
      )}
      <Section label={filtering ? `History · ${shown.length} of ${entries.length}` : `History · ${entries.length}`}>
        {error && <p className="t-body mb-2 text-rust">{error}</p>}
        {shown.length === 0 ? (
          <p className="t-body text-muted">{entries.length ? 'Nothing matches these filters.' : 'Nothing yet.'}</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((e) =>
              e.kind === 'note' ? (
                <NoteItem
                  key={`note${e.note.id}`}
                  note={e.note}
                  tracks={tracks}
                  canEdit={e.note.authorId !== null && e.note.authorId === viewerId}
                  canDelete={canDelete}
                  onSaved={(x) => setNotes((l) => l.map((y) => (y.id === x.id ? x : y)))}
                  onDelete={async () => {
                    const r = await api(`/api/notes/${e.note.id}`, { method: 'DELETE' });
                    if (r.ok) setNotes((l) => l.filter((y) => y.id !== e.note.id));
                    else setError(r.body.error || 'Could not delete the note.');
                  }}
                  onError={setError}
                />
              ) : (
                <li key={e.key} className="t-body flex items-baseline gap-2 py-1.5 text-muted">
                  <span className="text-[11px]">●</span>
                  <span className="min-w-0 flex-1 truncate">{e.text}</span>
                  <span className="text-[11px]">
                    {e.who} · {formatWhen(e.at)}
                  </span>
                </li>
              ),
            )}
          </ul>
        )}
      </Section>
    </>
  );

  const field = 'rounded border border-line bg-card px-1.5 py-0.5 outline-none focus:border-rust';
  const aside = (
    <Section
      label="Filter"
      action={
        filtering && (
          <button
            onClick={() => {
              setShow('all');
              setPerson('');
              setVersion('all');
              setFrom('');
              setTo('');
            }}
            className="text-muted hover:text-ink"
          >
            Clear
          </button>
        )
      }
    >
      <div className="t-body space-y-2">
        <div className="flex gap-3">
          {(['all', 'notes', 'events'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setShow(k)}
              className={show === k ? 'font-medium underline underline-offset-4' : 'text-muted hover:text-ink'}
            >
              {k === 'all' ? 'Everything' : k === 'notes' ? 'Notes' : 'Events'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="t-label w-16">Person</span>
          <select value={person} onChange={(e) => setPerson(e.target.value)} className={field}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="t-label w-16">About</span>
          <select
            value={String(version)}
            onChange={(e) => {
              const v = e.target.value;
              setVersion(v === 'all' || v === 'session' ? v : Number(v));
            }}
            className={field}
          >
            <option value="all">Anything</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                v{t.version}
              </option>
            ))}
            <option value="session">the whole session</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="t-label w-16">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        <label className="flex items-center gap-2">
          <span className="t-label w-16">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
        </label>
      </div>
    </Section>
  );

  return <DetailGrid main={main} aside={aside} />;
}

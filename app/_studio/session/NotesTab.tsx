'use client';

import { useMemo, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { NoteComposer, NoteItem } from '@/app/_studio/Notes';
import { DetailGrid, Section } from '@/app/_ui/layout';
import type { StudioNote, StudioTrack } from '@/lib/studioTypes';
import type { Workflow } from '@/lib/workflowTypes';

// The Notes tab (REQUIREMENTS S-5, S-11): every note on the session, newest
// first: on a mix, at a moment, or on the whole session. Filters to the left.
// What happened to the session (uploads, names) is the History tab.

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function NotesTab({
  workflow,
  setWorkflow,
  canEdit,
  projectId,
  tracks,
  notes,
  setNotes,
  viewerId,
  canContribute,
  canDelete,
}: {
  workflow: Workflow;
  setWorkflow: (w: Workflow) => void;
  canEdit: boolean;
  projectId: number;
  tracks: StudioTrack[];
  notes: StudioNote[];
  setNotes: React.Dispatch<React.SetStateAction<StudioNote[]>>;
  viewerId: string;
  canContribute: boolean;
  canDelete: boolean;
}) {
  const [person, setPerson] = useState('');
  const [version, setVersion] = useState<'all' | 'session' | number>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const settledNotes = new Set(workflow.cards.filter((c) => c.settled && c.sourceNoteId !== null).map((c) => c.sourceNoteId));

  async function settle(n: StudioNote) {
    setError('');
    const r = await api<{ workflow: Workflow }>(`/api/notes/${n.id}/settle`, { method: 'POST', body: JSON.stringify({}) });
    if (r.ok) setWorkflow(r.data.workflow);
    else setError(r.body.error || 'Could not settle the note.');
  }

  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of notes) seen.set(n.authorId ?? '', n.authorName);
    return Array.from(seen, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [notes]);

  const shown = notes.filter((n) => {
    if (person && (n.authorId ?? '') !== person) return false;
    if (version === 'session' && n.trackId !== null) return false;
    if (typeof version === 'number' && n.trackId !== version) return false;
    const day = localDay(n.createdAt);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  const filtering = person !== '' || version !== 'all' || from !== '' || to !== '';

  const main = (
    <>
      {canContribute && (
        <Section label="New note">
          <NoteComposer projectId={projectId} tracks={tracks} onAdded={(n) => setNotes((l) => [n, ...l])} />
        </Section>
      )}
      <Section label={filtering ? `Notes · ${shown.length} of ${notes.length}` : `Notes · ${notes.length}`}>
        {error && <p className="t-body mb-2 text-rust">{error}</p>}
        {shown.length === 0 ? (
          <p className="t-body text-muted">{notes.length ? 'No notes match these filters.' : 'No notes yet.'}</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                tracks={tracks}
                canEdit={n.authorId !== null && n.authorId === viewerId}
                canDelete={canDelete}
                onSaved={(x) => setNotes((l) => l.map((y) => (y.id === x.id ? x : y)))}
                onDelete={async () => {
                  const r = await api(`/api/notes/${n.id}`, { method: 'DELETE' });
                  if (r.ok) setNotes((l) => l.filter((y) => y.id !== n.id));
                  else setError(r.body.error || 'Could not delete the note.');
                }}
                onError={setError}
                settled={settledNotes.has(n.id)}
                onSettle={canEdit ? () => settle(n) : undefined}
              />
            ))}
          </ul>
        )}
      </Section>
    </>
  );

  const field = 'min-w-0 flex-1 rounded border border-line bg-card px-1.5 py-0.5 outline-none focus:border-rust';
  const aside = (
    <Section
      label="Filter"
      action={
        filtering && (
          <button
            onClick={() => {
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
        <label className="flex items-center gap-2">
          <span className="t-label w-16 shrink-0">Person</span>
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
          <span className="t-label w-16 shrink-0">About</span>
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
          <span className="t-label w-16 shrink-0">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        <label className="flex items-center gap-2">
          <span className="t-label w-16 shrink-0">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
        </label>
      </div>
    </Section>
  );

  return <DetailGrid main={main} aside={aside} side="left" />;
}

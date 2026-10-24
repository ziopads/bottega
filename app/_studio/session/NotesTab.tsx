'use client';

import { useMemo, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { NoteComposer, NoteItem } from '@/app/_studio/Notes';
import { DetailGrid, Section } from '@/app/_ui/layout';
import type { StudioNote, StudioTrack, StudioVariant } from '@/lib/studioTypes';
import { CARD_KINDS, type CardKind, type Workflow } from '@/lib/workflowTypes';
import { BUTTON, BUTTON_PRIMARY, FIELD } from '@/app/_ui/styles';

import { LearningMove } from './WorkflowTab';

// The Notes tab (REQUIREMENTS S-5, S-11): every note on the session, newest
// first: on a mix, at a moment, or on the whole session. Filters to the left.
// What happened to the session (uploads, names) is the History tab.
//
// A note can move (W-34, db/028): to a to-do in the current stage, keeping
// its mix and moment, or to a learning on the project's template. The note
// then leaves this list; a to-do can be moved back from the Workflow tab or
// To-dos, or straight away with Undo.

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
  variants,
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
  /** The session's named variants (db/015); notes on a mix can be filtered by its variant. */
  variants: StudioVariant[];
  notes: StudioNote[];
  setNotes: React.Dispatch<React.SetStateAction<StudioNote[]>>;
  viewerId: string;
  canContribute: boolean;
  canDelete: boolean;
}) {
  const [person, setPerson] = useState('');
  // A version's id, the whole session, or every mix of a variant ("v:" and its name; "v:" alone is the main mix).
  const [version, setVersion] = useState<'all' | 'session' | number | `v:${string}`>('all');
  const variantOf = new Map(tracks.map((t) => [t.id, t.variant]));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [moving, setMoving] = useState<{ id: number; to: 'todo' | 'learning' } | null>(null);
  const [movedNote, setMovedNote] = useState<{ text: string; cardId: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const stageLabel = workflow.stages.find((s) => s.key === workflow.stage)?.label ?? workflow.stages[0]?.label ?? '';
  const canMove = (n: StudioNote) => canEdit || (canContribute && n.authorId !== null && n.authorId === viewerId);

  async function move(url: string, body: unknown, done: (movedId: number) => void): Promise<boolean> {
    setError('');
    setBusy(true);
    const r = await api<{ workflow: Workflow; notes: StudioNote[]; movedId: number }>(url, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'That did not go through.');
      return false;
    }
    setWorkflow(r.data.workflow);
    setNotes(r.data.notes);
    setMoving(null);
    done(r.data.movedId);
    return true;
  }
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
    if (typeof version === 'string' && version.startsWith('v:') && (n.trackId === null || variantOf.get(n.trackId) !== version.slice(2))) return false;
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
        {movedNote && (
          <p role="status" className="t-body mb-2 flex flex-wrap items-center gap-3 rounded border border-ink px-3 py-1.5">
            <span>{movedNote.text}</span>
            {movedNote.cardId !== null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => move(`/api/cards/${movedNote.cardId}/move`, { to: 'note' }, () => setMovedNote(null))}
                className={BUTTON}
              >
                Undo
              </button>
            )}
            <button type="button" onClick={() => setMovedNote(null)} className={BUTTON}>
              Done
            </button>
          </p>
        )}
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
                onToTodo={canMove(n) && workflow.stages.length > 0 ? () => setMoving({ id: n.id, to: 'todo' }) : undefined}
                onToLearning={canMove(n) && workflow.learningsEditable ? () => setMoving({ id: n.id, to: 'learning' }) : undefined}
              >
                {moving?.id === n.id && moving.to === 'todo' && (
                  <TodoMove
                    workflow={workflow}
                    stageLabel={stageLabel}
                    busy={busy}
                    onCancel={() => setMoving(null)}
                    onMove={(input) =>
                      move(`/api/notes/${n.id}/move`, { to: 'todo', ...input }, (cardId) =>
                        setMovedNote({ text: `Moved to to-dos · ${stageLabel}${input.elementId ? '' : ' · no element yet'}.`, cardId }),
                      )
                    }
                  />
                )}
                {moving?.id === n.id && moving.to === 'learning' && (
                  <LearningMove
                    text={n.body}
                    stages={workflow.stages}
                    stage={workflow.stage ?? workflow.stages[0]?.key ?? ''}
                    busy={busy}
                    onCancel={() => setMoving(null)}
                    onMove={(stage, body) =>
                      move(`/api/notes/${n.id}/move`, { to: 'learning', stage, body }, () =>
                        setMovedNote({ text: `Moved to the learnings for ${workflow.stages.find((s) => s.key === stage)?.label ?? stage}.`, cardId: null }),
                      )
                    }
                  />
                )}
              </NoteItem>
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
            className={BUTTON}
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
              setVersion(v === 'all' || v === 'session' ? v : v.startsWith('v:') ? (v as `v:${string}`) : Number(v));
            }}
            className={field}
          >
            <option value="all">Anything</option>
            {variants.length > 0 && (
              <optgroup label="Every mix of">
                <option value="v:">Main</option>
                {variants.map((v) => (
                  <option key={v.id} value={`v:${v.name}`}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value="session">the whole project</option>
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

/** Moving a note to a to-do: its element, done-when and kind, all optional; it lands in the current stage. */
function TodoMove({
  workflow,
  stageLabel,
  busy,
  onMove,
  onCancel,
}: {
  workflow: Workflow;
  stageLabel: string;
  busy: boolean;
  onMove: (input: { elementId: number | null; doneWhen: string; kind: CardKind | null }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [elementId, setElementId] = useState<number | null>(null);
  const [doneWhen, setDoneWhen] = useState('');
  const [kind, setKind] = useState<CardKind | null>(null);
  const tops = workflow.elements.filter((e) => e.parentId === null).sort((a, b) => a.position - b.position);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onMove({ elementId, doneWhen, kind });
      }}
      className="mt-1.5 flex flex-wrap items-end gap-2 rounded border border-line p-2"
    >
      <p className="w-full text-[12px] font-medium">Make it a to-do for {stageLabel}</p>
      <label className="flex flex-col gap-0.5 text-[11px] text-muted">
        Element
        <select value={elementId ?? ''} onChange={(e) => setElementId(e.target.value ? Number(e.target.value) : null)} className={FIELD}>
          <option value="">Unassigned</option>
          {tops.map((t) => (
            <optgroup key={t.id} label={t.name}>
              <option value={t.id}>{t.name}</option>
              {workflow.elements
                .filter((c) => c.parentId === t.id)
                .sort((a, b) => a.position - b.position)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {t.name} / {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="flex min-w-[220px] flex-1 flex-col gap-0.5 text-[11px] text-muted">
        Done when
        <input value={doneWhen} onChange={(e) => setDoneWhen(e.target.value)} placeholder="Not written yet" className={FIELD} />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-muted">
        Kind
        <select value={kind ?? ''} onChange={(e) => setKind((e.target.value || null) as CardKind | null)} className={FIELD}>
          <option value="">—</option>
          {CARD_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy} className={BUTTON_PRIMARY}>
        Move to to-dos
      </button>
      <button type="button" onClick={onCancel} className={BUTTON}>
        Cancel
      </button>
      <p className="w-full text-[11px] text-muted">Element and done-when can wait; the mix and the moment stay with it.</p>
    </form>
  );
}

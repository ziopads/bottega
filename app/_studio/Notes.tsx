'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudioNote, StudioTrack } from '@/lib/studioTypes';
import { api } from './controls';

// A project's notes: newest first, each optionally about one version of the
// mix, filterable by person, version and date. Authors edit their own notes;
// authors and admins delete.

/** What the version filter and the composer's "about" menu hold. */
type Target = 'all' | 'project' | number;

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Notes({
  projectId,
  tracks,
  notes,
  setNotes,
  viewerEmail,
  isAdmin,
  focus,
}: {
  projectId: number;
  tracks: StudioTrack[];
  notes: StudioNote[];
  setNotes: React.Dispatch<React.SetStateAction<StudioNote[]>>;
  viewerEmail: string;
  isAdmin: boolean;
  /** Bumped by a track's "Notes" link: filter to that version and aim the composer at it. */
  focus: { trackId: number; n: number } | null;
}) {
  const latestId = tracks[0]?.id ?? null;
  const [about, setAbout] = useState<number | 'project'>(latestId ?? 'project');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [person, setPerson] = useState('');
  const [version, setVersion] = useState<Target>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const section = useRef<HTMLElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // A newly uploaded version becomes the default subject for the next note.
  const lastLatest = useRef(latestId);
  useEffect(() => {
    if (latestId !== lastLatest.current) {
      lastLatest.current = latestId;
      if (latestId !== null) setAbout(latestId);
    }
  }, [latestId]);

  useEffect(() => {
    if (!focus) return;
    setAbout(focus.trackId);
    setVersion(focus.trackId);
    section.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    box.current?.focus({ preventScroll: true });
  }, [focus]);

  const people = useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of notes) seen.set(n.author, n.authorCode ?? n.author);
    return Array.from(seen, ([email, label]) => ({ email, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [notes]);

  const shown = useMemo(
    () =>
      notes.filter((n) => {
        if (person && n.author !== person) return false;
        if (version === 'project' && n.trackId !== null) return false;
        if (typeof version === 'number' && n.trackId !== version) return false;
        const day = localDay(n.createdAt);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      }),
    [notes, person, version, from, to],
  );
  const filtering = person !== '' || version !== 'all' || from !== '' || to !== '';

  async function submit(e?: { preventDefault(): void }) {
    e?.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError('');
    const r = await api<{ note: StudioNote }>(`/api/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: draft, trackId: about === 'project' ? null : about }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not save the note.');
      return;
    }
    setNotes((list) => [r.data.note, ...list]);
    setDraft('');
  }

  function replace(n: StudioNote) {
    setNotes((list) => list.map((x) => (x.id === n.id ? n : x)));
  }

  async function remove(n: StudioNote) {
    setError('');
    const r = await api(`/api/notes/${n.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setError(r.body.error || 'Could not delete the note.');
      return;
    }
    setNotes((list) => list.filter((x) => x.id !== n.id));
  }

  const aboutOptions = (
    <>
      {tracks.map((t) => (
        <option key={t.id} value={t.id}>
          v{t.version}
          {t.id === latestId ? ' (latest)' : ''}
        </option>
      ))}
      <option value="project">the whole project</option>
    </>
  );

  return (
    <section ref={section} className="mt-10 scroll-mt-6">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Notes</h2>

      <form onSubmit={submit} className="rounded-lg border border-line bg-card p-3">
        <textarea
          ref={box}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl-Enter posts, like most comment boxes.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
          }}
          rows={3}
          placeholder="What do you hear? Timings, levels, arrangement…"
          className="w-full resize-y rounded-md border border-line bg-parchment px-3 py-2 text-sm outline-none focus:border-rust"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">About</span>
            <select
              value={String(about)}
              onChange={(e) => setAbout(e.target.value === 'project' ? 'project' : Number(e.target.value))}
              className="rounded-md border border-line bg-parchment px-2 py-1 outline-none focus:border-rust"
            >
              {aboutOptions}
            </select>
          </label>
          <button
            disabled={busy || !draft.trim()}
            className="ml-auto rounded-md bg-rust px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </form>

      {notes.length > 0 && (
        <div className="mb-3 mt-5 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Person</span>
            <select
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              className="rounded-md border border-line bg-card px-2 py-1 outline-none focus:border-rust"
            >
              <option value="">Everyone</option>
              {people.map((p) => (
                <option key={p.email} value={p.email}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">Version</span>
            <select
              value={String(version)}
              onChange={(e) => {
                const v = e.target.value;
                setVersion(v === 'all' || v === 'project' ? v : Number(v));
              }}
              className="rounded-md border border-line bg-card px-2 py-1 outline-none focus:border-rust"
            >
              <option value="all">All</option>
              {aboutOptions}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-line bg-card px-2 py-0.5 outline-none focus:border-rust"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-line bg-card px-2 py-0.5 outline-none focus:border-rust"
            />
          </label>
          {filtering && (
            <span className="flex items-baseline gap-2 text-xs text-muted">
              showing {shown.length} of {notes.length}
              <button
                onClick={() => {
                  setPerson('');
                  setVersion('all');
                  setFrom('');
                  setTo('');
                }}
                className="underline hover:text-ink"
              >
                clear
              </button>
            </span>
          )}
        </div>
      )}

      {error && <p className="mb-3 mt-3 text-sm text-rust">{error}</p>}

      {notes.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No notes yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">No notes match these filters.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((n) => (
            <NoteItem
              key={n.id}
              note={n}
              tracks={tracks}
              canEdit={n.author === viewerEmail}
              canDelete={n.author === viewerEmail || isAdmin}
              onSaved={replace}
              onDelete={() => remove(n)}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteItem({
  note: n,
  tracks,
  canEdit,
  canDelete,
  onSaved,
  onDelete,
  onError,
}: {
  note: StudioNote;
  tracks: StudioTrack[];
  canEdit: boolean;
  canDelete: boolean;
  onSaved: (n: StudioNote) => void;
  onDelete: () => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(n.body);
  const [about, setAbout] = useState<number | 'project'>(n.trackId ?? 'project');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  async function save() {
    setBusy(true);
    onError('');
    const r = await api<{ note: StudioNote }>(`/api/notes/${n.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: draft, trackId: about === 'project' ? null : about }),
    });
    setBusy(false);
    if (!r.ok) {
      onError(r.body.error || 'Could not save the note.');
      return;
    }
    onSaved(r.data.note);
    setEditing(false);
  }

  return (
    <li className="rounded-lg border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted">
        <span className="font-medium tracking-[0.04em] text-ink">{n.authorCode ?? n.author}</span>
        <span>{formatWhen(n.createdAt)}</span>
        {n.trackVersion !== null ? (
          <span className="rounded border border-line px-1.5 py-px">v{n.trackVersion}</span>
        ) : n.trackId === null ? null : (
          <span className="rounded border border-line px-1.5 py-px">deleted version</span>
        )}
        {n.editedAt && <span title={formatWhen(n.editedAt)}>edited</span>}
        <span className="ml-auto flex gap-3">
          {canEdit && !editing && (
            <button
              onClick={() => {
                setDraft(n.body);
                setAbout(n.trackId ?? 'project');
                setEditing(true);
              }}
              className="hover:text-ink"
            >
              Edit
            </button>
          )}
          {canDelete &&
            (armed ? (
              <>
                <button onClick={onDelete} className="text-rust underline">
                  Confirm delete
                </button>
                <button onClick={() => setArmed(false)} className="hover:text-ink">
                  cancel
                </button>
              </>
            ) : (
              <button onClick={() => setArmed(true)} className="hover:text-rust">
                Delete
              </button>
            ))}
        </span>
      </div>

      {editing ? (
        <div className="mt-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
            className="w-full resize-y rounded-md border border-line bg-parchment px-3 py-2 text-sm outline-none focus:border-rust"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <select
              value={String(about)}
              onChange={(e) => setAbout(e.target.value === 'project' ? 'project' : Number(e.target.value))}
              className="rounded-md border border-line bg-parchment px-2 py-1 outline-none focus:border-rust"
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  v{t.version}
                </option>
              ))}
              <option value="project">the whole project</option>
            </select>
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="rounded-md bg-rust px-3 py-1 text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{n.body}</p>
      )}
    </li>
  );
}

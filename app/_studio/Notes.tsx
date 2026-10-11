'use client';

import { useState } from 'react';

import type { StudioNote, StudioTrack } from '@/lib/studioTypes';
import { formatDuration } from '@/lib/studioTypes';
import { api } from './controls';

// Notes on a session (REQUIREMENTS S-4, S-11): one note's display and editing,
// and the box that writes a new one. The tabs decide which notes to show;
// the Mixes tab shows a mix's notes beside it, pinned to moments, and the
// Notes tab shows them all.

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "2:31" for a moment in a mix. */
export function formatMoment(seconds: number): string {
  return formatDuration(seconds) || '0:00';
}

export function NoteItem({
  note: n,
  tracks,
  canEdit,
  canDelete,
  showVersion = true,
  onSaved,
  onDelete,
  onError,
  onMoment,
}: {
  note: StudioNote;
  tracks: StudioTrack[];
  canEdit: boolean;
  canDelete: boolean;
  /** Off where the version is already the context (beside a mix). */
  showVersion?: boolean;
  onSaved: (n: StudioNote) => void;
  onDelete: () => void;
  onError: (msg: string) => void;
  /** Play the mix from the note's moment. */
  onMoment?: (n: StudioNote) => void;
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
    <li className="t-body py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
        {n.positionS !== null && n.trackId !== null && (
          <button
            type="button"
            onClick={() => onMoment?.(n)}
            disabled={!onMoment}
            className="t-num font-medium text-ink hover:underline disabled:no-underline"
            title={onMoment ? 'Play from here' : undefined}
          >
            {formatMoment(n.positionS)}
          </button>
        )}
        <span className="font-medium text-ink">{n.authorName}</span>
        <span>{formatWhen(n.createdAt)}</span>
        {showVersion && (n.trackVersion !== null ? <span>v{n.trackVersion}</span> : n.trackId !== null && <span>deleted version</span>)}
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
                  Confirm
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
        <div className="mt-1.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
            className="t-body w-full resize-y rounded border border-line bg-parchment px-2 py-1.5 outline-none focus:border-rust"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <select
              value={String(about)}
              onChange={(e) => setAbout(e.target.value === 'project' ? 'project' : Number(e.target.value))}
              className="rounded border border-line bg-parchment px-1.5 py-0.5 outline-none focus:border-rust"
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  v{t.version}
                </option>
              ))}
              <option value="project">the whole session</option>
            </select>
            <button onClick={save} disabled={busy || !draft.trim()} className="rounded bg-rust px-3 py-0.5 text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">{n.body}</p>
      )}
    </li>
  );
}

/**
 * The box that writes a note. Beside a mix, it offers to pin the note to the
 * moment the mix is at (captured when you start writing, renewable with
 * "now"); elsewhere it asks which version the note is about.
 */
export function NoteComposer({
  projectId,
  tracks,
  fixedTrackId,
  moment,
  placeholder = 'What do you hear? Timings, levels, arrangement…',
  onAdded,
}: {
  projectId: number;
  tracks: StudioTrack[];
  /** Beside a mix: the note is about this version. */
  fixedTrackId?: number;
  /** Beside a mix: where its player is now, in seconds. */
  moment?: () => number;
  placeholder?: string;
  onAdded: (n: StudioNote) => void;
}) {
  const [draft, setDraft] = useState('');
  const [about, setAbout] = useState<number | 'project'>(fixedTrackId ?? tracks[0]?.id ?? 'project');
  const [at, setAt] = useState<number | null>(null);
  const [pin, setPin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function capture() {
    if (moment) setAt(Math.round(moment() * 10) / 10);
  }

  async function submit() {
    if (!draft.trim()) return;
    setBusy(true);
    setError('');
    const trackId = fixedTrackId ?? (about === 'project' ? null : about);
    const positionS = fixedTrackId && pin && at !== null && at > 0 ? at : null;
    const r = await api<{ note: StudioNote }>(`/api/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body: draft, trackId, positionS }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not save the note.');
      return;
    }
    onAdded(r.data.note);
    setDraft('');
    setAt(null);
  }

  return (
    <div className="t-body">
      <textarea
        value={draft}
        onFocus={() => at === null && capture()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl-Enter posts, like most comment boxes.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={3}
        placeholder={placeholder}
        className="t-body w-full resize-y rounded border border-line bg-parchment px-2 py-1.5 outline-none focus:border-rust"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {fixedTrackId !== undefined ? (
          at !== null &&
          at > 0 && (
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
              at <span className="t-num text-ink">{formatMoment(at)}</span>
              <button type="button" onClick={capture} className="underline hover:text-ink">
                now
              </button>
            </label>
          )
        ) : (
          <label className="flex items-center gap-1.5 text-muted">
            About
            <select
              value={String(about)}
              onChange={(e) => setAbout(e.target.value === 'project' ? 'project' : Number(e.target.value))}
              className="rounded border border-line bg-parchment px-1.5 py-0.5 text-ink outline-none focus:border-rust"
            >
              {tracks.map((t, i) => (
                <option key={t.id} value={t.id}>
                  v{t.version}
                  {i === 0 ? ' (latest)' : ''}
                </option>
              ))}
              <option value="project">the whole session</option>
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.trim()}
          className="ml-auto rounded bg-rust px-3 py-1 text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Add note'}
        </button>
      </div>
      {error && <p className="mt-1 text-rust">{error}</p>}
    </div>
  );
}

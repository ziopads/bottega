'use client';

import { useState } from 'react';

import type { StudioNote, StudioTrack } from '@/lib/studioTypes';
import { formatDuration } from '@/lib/studioTypes';
import { api } from './controls';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';

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
  onSettle,
  settled = false,
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
  /** Make the note a settled decision (REQUIREMENTS W-9); edit access only. */
  onSettle?: () => void;
  /** Already a settled decision. */
  settled?: boolean;
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
        {showVersion && (n.trackLabel !== null ? <span>{n.trackLabel}</span> : n.trackId !== null && <span>deleted version</span>)}
        {n.editedAt && <span title={formatWhen(n.editedAt)}>edited</span>}
        {settled && <span className="text-ink">settled</span>}
        <span className="ml-auto flex gap-3">
          {onSettle && !settled && !editing && (
            <button onClick={onSettle} className={BUTTON} title="Make this note a settled decision on the Workflow tab">
              Settle
            </button>
          )}
          {canEdit && !editing && (
            <button
              onClick={() => {
                setDraft(n.body);
                setAbout(n.trackId ?? 'project');
                setEditing(true);
              }}
              className={BUTTON}
            >
              Edit
            </button>
          )}
          {canDelete &&
            (armed ? (
              <>
                <button onClick={onDelete} className={BUTTON_PRIMARY}>
                  Confirm
                </button>
                <button onClick={() => setArmed(false)} className={BUTTON}>
                  cancel
                </button>
              </>
            ) : (
              <button onClick={() => setArmed(true)} className={BUTTON_DANGER}>
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
                  {t.label}
                </option>
              ))}
              <option value="project">the whole project</option>
            </select>
            <button onClick={save} disabled={busy || !draft.trim()} className={BUTTON_PRIMARY}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className={BUTTON}>
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
 * "1:35" (or "95", "1:02:05", "1:35.5") as seconds; '' as no moment; null when
 * it cannot be read.
 */
export function parseMoment(text: string): number | '' | null {
  const t = text.trim();
  if (!t) return '';
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  const s = parts.reduce((acc, p) => acc * 60 + p, 0);
  return Math.round(s * 10) / 10;
}

/**
 * The box that writes a note. A note about a version can be pinned to a
 * moment in it, typed as "1:35". Beside a mix the moment is filled in from
 * the player when you start writing (if it is playing or paused past the
 * start), and "now" fills it again; elsewhere the box asks which version the
 * note is about and the moment is typed. An empty moment leaves the note
 * unpinned.
 */
export function NoteComposer({
  projectId,
  tracks,
  fixedTrackId,
  moment,
  placeholder = 'What do you hear? Timings, levels, arrangement…',
  initialAt,
  onAdded,
}: {
  projectId: number;
  tracks: StudioTrack[];
  /** Beside a mix: the note is about this version. */
  fixedTrackId?: number;
  /** Beside a mix: where its player is now, in seconds. */
  moment?: () => number;
  placeholder?: string;
  /** Opened from the player bar's "Note at 1:35": the moment, filled in, and the box ready to type in. */
  initialAt?: number;
  onAdded: (n: StudioNote) => void;
}) {
  const [draft, setDraft] = useState('');
  const [about, setAbout] = useState<number | 'project'>(fixedTrackId ?? tracks[0]?.id ?? 'project');
  const [at, setAt] = useState(initialAt !== undefined ? formatMoment(initialAt) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const trackId = fixedTrackId ?? (about === 'project' ? null : about);
  const track = trackId === null ? null : (tracks.find((t) => t.id === trackId) ?? null);

  function fromPlayer(onlyIfEmpty: boolean) {
    if (!moment || (onlyIfEmpty && at)) return;
    const s = moment();
    if (s > 0) setAt(formatMoment(Math.round(s * 10) / 10));
  }

  async function submit() {
    if (!draft.trim()) return;
    let positionS: number | null = null;
    if (trackId !== null) {
      const p = parseMoment(at);
      if (p === null) {
        setError('Write the moment as minutes and seconds, such as 1:35.');
        return;
      }
      if (p !== '') {
        if (track?.durationS && p > track.durationS) {
          setError(`${track.label} is ${formatMoment(track.durationS)} long; that moment is past its end.`);
          return;
        }
        positionS = p;
      }
    }
    setBusy(true);
    setError('');
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
    setAt('');
  }

  return (
    <div className="t-body">
      <textarea
        value={draft}
        autoFocus={initialAt !== undefined}
        onFocus={() => fromPlayer(true)}
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
        {fixedTrackId === undefined && (
          <label className="flex items-center gap-1.5 text-muted">
            About
            <select
              value={String(about)}
              onChange={(e) => {
                setAbout(e.target.value === 'project' ? 'project' : Number(e.target.value));
                // A moment belongs to the version it was heard in.
                setAt('');
              }}
              className="rounded border border-line bg-parchment px-1.5 py-0.5 text-ink outline-none focus:border-rust"
            >
              {tracks.map((t, i) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {i === 0 ? ' (latest)' : ''}
                </option>
              ))}
              <option value="project">the whole project</option>
            </select>
          </label>
        )}
        {trackId !== null && (
          <label className="flex items-center gap-1.5 text-muted">
            at
            <input
              value={at}
              onChange={(e) => setAt(e.target.value)}
              placeholder="0:00"
              inputMode="decimal"
              aria-label="The moment in the mix this note is about, such as 1:35; leave empty for the whole version"
              className="t-num w-16 rounded border border-line bg-parchment px-1.5 py-0.5 text-ink outline-none focus:border-rust"
            />
            {moment && (
              <button type="button" onClick={() => fromPlayer(false)} className={BUTTON}>
                now
              </button>
            )}
          </label>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !draft.trim()}
          className={`ml-auto ${BUTTON_PRIMARY}`}
        >
          {busy ? 'Saving…' : 'Add note'}
        </button>
      </div>
      {error && <p className="mt-1 text-rust">{error}</p>}
    </div>
  );
}

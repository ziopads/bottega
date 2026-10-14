'use client';

import { useEffect, useRef, useState } from 'react';

import { api, InlineEdit } from '@/app/_studio/controls';
import { formatMoment, NoteComposer, NoteItem } from '@/app/_studio/Notes';
import type { PlayItem } from '@/app/_ui/audio/deck';
import Player, { type PlayerHandle } from '@/app/_ui/audio/Player';
import type { Marker } from '@/app/_ui/audio/Waveform';
import { DetailGrid, Section } from '@/app/_ui/layout';
import type { StudioNote, StudioReference, StudioTrack } from '@/lib/studioTypes';
import { formatBytes, formatDuration } from '@/lib/studioTypes';

import { audioUrl, formatDate, uploadMix, uploadReference } from './audioUpload';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';

// The Mixes tab (REQUIREMENTS S-3, S-10, S-11): every version as a slim row
// with its waveform, newest first, the current one marked; the upload that
// adds the next; references to compare against. Beside them, the notes on
// the selected version, each pinned to a moment, which play it from there.

type Upload = { name: string; progress: number; error?: string };

/** The session as the site's player bar names it. */
type Session = { code: string; title: string };

export default function MixesTab({
  projectId,
  session,
  initialTrackId,
  initialAt,
  tracks,
  variant,
  setTracks,
  references,
  setReferences,
  notes,
  setNotes,
  currentId,
  chosenByHand,
  viewerId,
  canEdit,
  canContribute,
  canDelete,
  uploadsEnabled,
  onMakeCurrent,
  onDelete,
  onLength,
}: {
  projectId: number;
  session: Session;
  /** The mix to open on (?track=, from the player bar); otherwise the current one. */
  initialTrackId: number | null;
  /** The note box opens at this moment on that mix (?at=, the bar's "Note at 1:35"). */
  initialAt: number | null;
  /** The chosen variant's mixes, newest first. */
  tracks: StudioTrack[];
  /** The variant chosen above the tabs, where uploads go: '' is the main mix (db/015). */
  variant: string;
  setTracks: React.Dispatch<React.SetStateAction<StudioTrack[]>>;
  references: StudioReference[];
  setReferences: React.Dispatch<React.SetStateAction<StudioReference[]>>;
  notes: StudioNote[];
  setNotes: React.Dispatch<React.SetStateAction<StudioNote[]>>;
  currentId: number | null;
  chosenByHand: boolean;
  viewerId: string;
  canEdit: boolean;
  canContribute: boolean;
  canDelete: boolean;
  uploadsEnabled: boolean;
  onMakeCurrent: (t: StudioTrack | null) => void;
  onDelete: (t: StudioTrack) => void;
  onLength: (id: number, seconds: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(
    initialTrackId !== null && tracks.some((t) => t.id === initialTrackId) ? initialTrackId : (currentId ?? tracks[0]?.id ?? null),
  );
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const players = useRef(new Map<number, PlayerHandle>());

  const selectedTrack = tracks.find((t) => t.id === selected) ?? null;
  // Each mix as the site's player plays it; the variant's mixes are its queue.
  const itemOf = (t: StudioTrack): PlayItem => ({
    trackId: t.id,
    projectId,
    code: session.code,
    title: session.title,
    label: t.label,
    kind: 'mix',
    variant: t.variant,
    durationS: t.durationS,
  });
  const queue = tracks.map(itemOf);

  // The moment from the bar has been used once the box opens: a reload should not open it again.
  useEffect(() => {
    if (initialAt === null) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('at');
    window.history.replaceState(null, '', url);
  }, [initialAt]);
  const notesFor = (id: number) => notes.filter((n) => n.trackId === id);
  const markersFor = (id: number): Marker[] =>
    notesFor(id)
      .filter((n) => n.positionS !== null)
      .map((n) => ({ id: n.id, at: n.positionS!, label: `${formatMoment(n.positionS!)} · ${n.body.slice(0, 60)}` }));
  const asideNotes = selected
    ? [...notesFor(selected)].sort((a, b) => (a.positionS ?? Infinity) - (b.positionS ?? Infinity) || b.createdAt.localeCompare(a.createdAt))
    : [];

  async function uploadFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const mp3s = files.filter((f) => /\.mp3$/i.test(f.name));
    const skipped = files.filter((f) => !/\.mp3$/i.test(f.name));
    setError(skipped.length ? `Only MP3s can be uploaded; skipped ${skipped.map((f) => f.name).join(', ')}.` : '');
    if (!mp3s.length) return;
    const start = uploads.length;
    setUploads((u) => [...u, ...mp3s.map((f) => ({ name: f.name, progress: 0 }))]);
    // One after another, so versions are numbered in the order chosen.
    for (let i = 0; i < mp3s.length; i++) {
      const set = (u: Partial<Upload>) => setUploads((l) => l.map((x, j) => (j === start + i ? { ...x, ...u } : x)));
      try {
        const track = await uploadMix(projectId, mp3s[i], (p) => set({ progress: p }), variant);
        setTracks((l) =>
          [track, ...l].sort(
            (a, b) =>
              Number(a.variant !== '') - Number(b.variant !== '') ||
              a.variant.toLowerCase().localeCompare(b.variant.toLowerCase()) ||
              b.version - a.version,
          ),
        );
        setSelected(track.id);
        set({ progress: 1 });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Upload failed.' });
      }
    }
  }

  function playFrom(n: StudioNote) {
    if (n.trackId === null || n.positionS === null) return;
    setSelected(n.trackId);
    players.current.get(n.trackId)?.seek(n.positionS, true);
  }

  const main = (
    <>
      <Section label={`Mixes · ${tracks.length}`}>
        {tracks.length === 0 && <p className="t-body text-muted">{variant ? `No mixes of ${variant} yet.` : 'No mixes yet.'}</p>}
        <ul className="divide-y divide-line">
          {tracks.map((t) => (
            <MixRow
              key={t.id}
              track={t}
              item={itemOf(t)}
              queue={queue}
              current={t.id === currentId}
              chosenByHand={chosenByHand && t.id === currentId}
              selected={t.id === selected}
              noteCount={notesFor(t.id).length}
              markers={markersFor(t.id)}
              canEdit={canEdit}
              canDelete={canDelete}
              register={(h) => (h ? players.current.set(t.id, h) : players.current.delete(t.id))}
              onSelect={() => setSelected(t.id)}
              onMakeCurrent={() => onMakeCurrent(t)}
              onUseNewest={() => onMakeCurrent(null)}
              onDelete={() => onDelete(t)}
              onLength={(s) => onLength(t.id, s)}
              onMarker={(m) => {
                setSelected(t.id);
                document.getElementById(`note-${m.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              }}
            />
          ))}
        </ul>

        {canContribute &&
          (uploadsEnabled ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void uploadFiles(e.dataTransfer.files);
              }}
              className={`t-body mt-3 rounded border border-dashed px-3 py-3 text-center ${dragging ? 'border-ink' : 'border-line text-muted'}`}
            >
              Drop an MP3 to add the next version of {variant ? <span className="text-ink">{variant}</span> : 'the main mix'}
              , or{' '}
              <button onClick={() => fileInput.current?.click()} className="underline hover:text-ink">
                choose a file
              </button>
              .
              <input
                ref={fileInput}
                type="file"
                accept=".mp3,audio/mpeg"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void uploadFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          ) : (
            <p className="t-body mt-3 text-muted">Uploads are off until the audio bucket is configured.</p>
          ))}
        {uploads.length > 0 && (
          <ul className="t-body mt-2 space-y-0.5">
            {uploads.map((u, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.error ? (
                  <span className="text-rust">{u.error}</span>
                ) : u.progress >= 1 ? (
                  <span className="text-muted">done</span>
                ) : (
                  <span className="h-1 w-32 overflow-hidden rounded bg-line">
                    <span className="block h-full bg-ink" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="t-body mt-2 text-rust">{error}</p>}
      </Section>

      <References
        projectId={projectId}
        session={session}
        references={references}
        setReferences={setReferences}
        canContribute={canContribute}
        canDelete={canDelete}
        uploadsEnabled={uploadsEnabled}
        onLength={onLength}
      />
    </>
  );

  const aside = selectedTrack ? (
    <Section label={`Notes on ${selectedTrack.label}`}>
      {canContribute && (
        <NoteComposer
          key={selectedTrack.id}
          projectId={projectId}
          tracks={tracks}
          fixedTrackId={selectedTrack.id}
          moment={() => players.current.get(selectedTrack.id)?.currentTime() ?? 0}
          initialAt={selectedTrack.id === initialTrackId && initialAt !== null ? initialAt : undefined}
          placeholder="Play the mix and write what you hear; the note is pinned to the moment."
          onAdded={(n) => setNotes((l) => [n, ...l])}
        />
      )}
      {asideNotes.length === 0 ? (
        <p className="t-body mt-3 text-muted">No notes on this version yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {asideNotes.map((n) => (
            <div key={n.id} id={`note-${n.id}`}>
              <NoteItem
                note={n}
                tracks={tracks}
                showVersion={false}
                canEdit={n.authorId !== null && n.authorId === viewerId}
                canDelete={canDelete}
                onSaved={(x) => setNotes((l) => l.map((y) => (y.id === x.id ? x : y)))}
                onDelete={async () => {
                  const r = await api(`/api/notes/${n.id}`, { method: 'DELETE' });
                  if (r.ok) setNotes((l) => l.filter((y) => y.id !== n.id));
                  else setError(r.body.error || 'Could not delete the note.');
                }}
                onError={setError}
                onMoment={playFrom}
              />
            </div>
          ))}
        </ul>
      )}
    </Section>
  ) : null;

  return <DetailGrid main={main} aside={aside} />;
}

function MixRow({
  track: t,
  item,
  queue,
  current,
  chosenByHand,
  selected,
  noteCount,
  markers,
  canEdit,
  canDelete,
  register,
  onSelect,
  onMakeCurrent,
  onUseNewest,
  onDelete,
  onLength,
  onMarker,
}: {
  track: StudioTrack;
  item: PlayItem;
  queue: PlayItem[];
  current: boolean;
  chosenByHand: boolean;
  selected: boolean;
  noteCount: number;
  markers: Marker[];
  canEdit: boolean;
  canDelete: boolean;
  register: (h: PlayerHandle | null) => void;
  onSelect: () => void;
  onMakeCurrent: () => void;
  onUseNewest: () => void;
  onDelete: () => void;
  onLength: (seconds: number) => void;
  onMarker: (m: Marker) => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <li className="cursor-pointer py-2.5" onClick={onSelect} aria-current={selected ? 'true' : undefined}>
      <div className="t-body mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {/* The version whose notes the aside shows is marked by its number alone. */}
        <span className={`t-lead t-num font-medium ${selected ? 'text-rust' : ''}`}>v{t.version}</span>
        <span className="min-w-0 max-w-full truncate" title={t.originalFilename}>
          {t.originalFilename}
        </span>
        {current && <span className="t-label text-ink">current{chosenByHand ? ' · by hand' : ''}</span>}
        <span className="t-num text-[11px] text-muted">
          {[t.uploadedByName, formatDate(t.uploadedAt), formatBytes(t.bytes)].filter(Boolean).join(' · ')}
        </span>
        <span className="ml-auto flex gap-3 text-[11px] text-muted" onClick={(e) => e.stopPropagation()}>
          {noteCount > 0 && (
            <button onClick={onSelect} className={BUTTON}>
              {noteCount} {noteCount === 1 ? 'note' : 'notes'}
            </button>
          )}
          <a href={audioUrl(t, true)} className="hover:text-ink">
            Download
          </a>
          {canEdit && !current && (
            <button onClick={onMakeCurrent} className={BUTTON}>
              Make current
            </button>
          )}
          {canEdit && chosenByHand && (
            <button onClick={onUseNewest} className={BUTTON}>
              Use the newest
            </button>
          )}
          {canDelete &&
            (armed ? (
              <>
                <button onClick={onDelete} className={BUTTON_PRIMARY}>
                  Delete {t.label}
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
      <Player
        ref={register}
        item={item}
        queue={queue}
        peaks={t.peaks}
        durationS={t.durationS}
        markers={markers}
        height={current ? 44 : 32}
        onDuration={onLength}
        onMarker={onMarker}
      />
    </li>
  );
}

// ── References ────────────────────────────────────────────────────────────────

/**
 * Other artists' tracks kept beside the session for comparison. Uploaded the
 * same way as a mix, then recorded with a credit. Contributors add them and
 * correct credits; only the owner removes one.
 */
function References({
  projectId,
  session,
  references,
  setReferences,
  canContribute,
  canDelete,
  uploadsEnabled,
  onLength,
}: {
  projectId: number;
  session: Session;
  references: StudioReference[];
  setReferences: React.Dispatch<React.SetStateAction<StudioReference[]>>;
  canContribute: boolean;
  canDelete: boolean;
  uploadsEnabled: boolean;
  onLength: (id: number, seconds: number) => void;
}) {
  const [credit, setCredit] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const refItem = (r: StudioReference): PlayItem => ({
    trackId: r.id,
    projectId,
    code: session.code,
    title: session.title,
    label: r.credit || r.originalFilename,
    kind: 'reference',
    variant: '',
    durationS: r.durationS,
  });
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError('');
    if (!/\.mp3$/i.test(file.name)) {
      setError('Only MP3s can be uploaded.');
      return;
    }
    setBusy(0);
    try {
      const ref = await uploadReference(projectId, file, credit, setBusy);
      setReferences((l) => [...l, ref]);
      setCredit('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(null);
    }
  }

  async function saveCredit(r: StudioReference, value: string): Promise<boolean> {
    setError('');
    const res = await api<{ reference: StudioReference }>(`/api/references/${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ credit: value }),
    });
    if (!res.ok) {
      setError(res.body.error || 'Could not save the credit.');
      return false;
    }
    setReferences((l) => l.map((x) => (x.id === r.id ? { ...res.data.reference, peaks: x.peaks } : x)));
    return true;
  }

  async function remove(r: StudioReference) {
    setError('');
    const res = await api(`/api/references/${r.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError(res.body.error || 'Could not remove the reference.');
      return;
    }
    setReferences((l) => l.filter((x) => x.id !== r.id));
  }

  return (
    <Section label={`References · ${references.length}`}>
      {references.length === 0 && <p className="t-body text-muted">Other artists’ tracks to compare against go here.</p>}
      <ul className="divide-y divide-line">
        {references.map((r) => (
          <li key={r.id} className="py-2">
            <div className="t-body mb-1 flex flex-wrap items-baseline gap-x-3">
              <span className="min-w-0 flex-1 font-medium">
                {canContribute ? (
                  <InlineEdit value={r.credit} placeholder={r.originalFilename} label="Credit" onSave={(v) => saveCredit(r, v)} />
                ) : (
                  r.credit || r.originalFilename
                )}
              </span>
              <span className="t-num text-[11px] text-muted">
                {[formatDuration(r.durationS), formatBytes(r.bytes)].filter(Boolean).join(' · ')}
              </span>
              <span className="flex gap-3 text-[11px] text-muted">
                <a href={audioUrl(r, true)} className="hover:text-ink">
                  Download
                </a>
                {canDelete && <ConfirmButton label="Remove" onConfirm={() => remove(r)} />}
              </span>
            </div>
            <Player
              item={refItem(r)}
              queue={references.map(refItem)}
              peaks={r.peaks}
              durationS={r.durationS}
              height={28}
              onDuration={(s) => onLength(r.id, s)}
            />
          </li>
        ))}
      </ul>
      {uploadsEnabled && canContribute && (
        <div className="t-body mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={credit}
            onChange={(e) => setCredit(e.target.value)}
            placeholder="Artist — Title"
            aria-label="Credit for the next reference"
            className="w-56 rounded border border-line bg-card px-2 py-0.5 outline-none focus:border-rust"
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
            className={BUTTON}
          >
            {busy !== null ? `Uploading ${Math.round(busy * 100)}%…` : 'Add a reference MP3'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".mp3,audio/mpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {error && <p className="t-body mt-2 text-rust">{error}</p>}
    </Section>
  );
}

function ConfirmButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <>
      <button onClick={onConfirm} className={BUTTON_PRIMARY}>
        Confirm
      </button>
      <button onClick={() => setArmed(false)} className={BUTTON}>
        cancel
      </button>
    </>
  ) : (
    <button onClick={() => setArmed(true)} className={BUTTON_DANGER}>
      {label}
    </button>
  );
}

'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type {
  StudioArtist,
  StudioName,
  StudioNote,
  StudioProject,
  StudioReference,
  StudioRelease,
  StudioShare,
  StudioTrack,
} from '@/lib/studioTypes';
import { formatBytes, formatDuration, levelAtLeast } from '@/lib/studioTypes';
import { api, GenreSelect, InlineEdit, Stars } from './controls';
import Notes from './Notes';
import Sharing from './Sharing';

// One project: its details, its mixes (the current one large, the rest smaller
// below, newest first), the upload that adds the next version, its references
// (other artists' tracks to compare against), its notes, and, for its owner,
// who it is shared with.
//
// What the controls offer follows the viewer's level (REQUIREMENTS AC-5): view
// shows and plays; contribute adds uploads and notes; edit adds the fields and
// the current mix; only the owner deletes, credits an artist and shares. The
// routes and the database enforce the same rules; this only keeps the page
// from offering what would be refused.
//
// Upload is two requests around a direct browser → R2 PUT (see
// lib/studioAudio.ts for why the file never passes through the app):
//   1. POST …/tracks/upload   → signed PUT URL + key
//   2. PUT the file to R2      (XHR, for a progress bar)
//   3. POST …/tracks           → the server checks the object and records the version

type Upload = { name: string; progress: number; error?: string };

function audioUrl(t: { id: number }, download = false) {
  return `/api/tracks/${t.id}/audio${download ? '?download=1' : ''}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Duration from the file's own metadata, read locally before upload. Null if the browser can't tell. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => done(null), 5000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    audio.src = url;
  });
}

function putWithProgress(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Must match the ContentType the URL was signed with (lib/studioAudio.ts).
    xhr.setRequestHeader('Content-Type', 'audio/mpeg');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the upload (${xhr.status}).`)));
    // A CORS rejection surfaces here with no status: the bucket's CORS rule is the usual cause.
    xhr.onerror = () => reject(new Error('The upload could not reach storage (network or CORS).'));
    xhr.send(file);
  });
}

export default function ProjectDetail({
  initialProject,
  initialTracks,
  names,
  artists,
  initialGenres,
  initialNotes,
  initialReferences,
  releases,
  viewerId,
  initialShares,
  uploadsEnabled,
}: {
  initialProject: StudioProject;
  initialTracks: StudioTrack[];
  names: StudioName[];
  artists: StudioArtist[];
  initialGenres: string[];
  initialNotes: StudioNote[];
  initialReferences: StudioReference[];
  releases: StudioRelease[];
  viewerId: string;
  initialShares: StudioShare[];
  uploadsEnabled: boolean;
}) {
  const [project, setProject] = useState(initialProject);
  const isOwner = project.level === 'owner';
  const canEdit = levelAtLeast(project.level, 'edit');
  const canContribute = levelAtLeast(project.level, 'contribute');
  const canDelete = isOwner;
  const [tracks, setTracks] = useState(initialTracks);
  const [nameHistory, setNameHistory] = useState(names);
  const [genres, setGenres] = useState(initialGenres);
  const [notes, setNotes] = useState(initialNotes);
  const [references, setReferences] = useState(initialReferences);
  const [noteFocus, setNoteFocus] = useState<{ trackId: number; n: number } | null>(null);

  const noteCounts = new Map<number, number>();
  for (const n of notes) if (n.trackId !== null) noteCounts.set(n.trackId, (noteCounts.get(n.trackId) ?? 0) + 1);
  function openNotes(t: StudioTrack) {
    setNoteFocus((f) => ({ trackId: t.id, n: (f?.n ?? 0) + 1 }));
  }
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const players = useRef(new Set<HTMLAudioElement>());

  async function patch(fields: Record<string, unknown>): Promise<boolean> {
    setError('');
    const r = await api<{ project: StudioProject }>(`/api/projects/${project.id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not save the change.');
      return false;
    }
    if ('workingName' in fields && r.data.project.workingName !== project.workingName && r.data.project.workingName) {
      setNameHistory((h) => [
        { name: r.data.project.workingName, setByName: 'you', setAt: new Date().toISOString() },
        ...h,
      ]);
    }
    setProject(r.data.project);
    return true;
  }

  async function addGenre(name: string): Promise<string | null> {
    setError('');
    const r = await api<{ name: string; genres: string[] }>('/api/genres', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not add the genre.');
      return null;
    }
    setGenres(r.data.genres);
    return r.data.name;
  }

  // A file with no length on record (older uploads) reports one as soon as a
  // player has read its metadata, so lengths fill in as sessions are visited.
  async function fillLength(id: number, el: HTMLAudioElement) {
    const d = el.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const r = await api<{ filled: boolean }>(`/api/audio/${id}/duration`, {
      method: 'POST',
      body: JSON.stringify({ durationS: d }),
    });
    if (!r.ok) return;
    setTracks((list) => list.map((x) => (x.id === id && x.durationS === null ? { ...x, durationS: d } : x)));
    setReferences((list) => list.map((x) => (x.id === id && x.durationS === null ? { ...x, durationS: d } : x)));
  }
  function lengthProbe(t: { id: number; durationS: number | null }) {
    return t.durationS === null
      ? (e: React.SyntheticEvent<HTMLAudioElement>) => fillLength(t.id, e.currentTarget)
      : undefined;
  }

  async function makeCurrent(t: StudioTrack | null) {
    await patch({ currentMixId: t ? t.id : null });
  }

  // One track plays at a time: starting one pauses the rest.
  function onPlay(e: React.SyntheticEvent<HTMLAudioElement>) {
    players.current.forEach((a) => a !== e.currentTarget && a.pause());
  }
  function register(el: HTMLAudioElement | null) {
    if (el) players.current.add(el);
  }

  async function uploadOne(file: File, index: number) {
    const set = (u: Partial<Upload>) =>
      setUploads((list) => list.map((x, i) => (i === index ? { ...x, ...u } : x)));
    try {
      const signed = await api<{ url: string; key: string }>(`/api/projects/${project.id}/tracks/upload`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, bytes: file.size }),
      });
      if (!signed.ok) throw new Error(signed.body.error || 'Could not start the upload.');
      const durationS = await readDuration(file);
      await putWithProgress(signed.data.url, file, (f) => set({ progress: f }));
      const saved = await api<{ track: StudioTrack }>(`/api/projects/${project.id}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ key: signed.data.key, filename: file.name, durationS }),
      });
      if (!saved.ok) throw new Error(saved.body.error || 'Uploaded, but could not record the version.');
      setTracks((list) => [saved.data.track, ...list].sort((a, b) => b.version - a.version));
      set({ progress: 1 });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Upload failed.' });
    }
  }

  async function uploadFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const rejected = files.filter((f) => !/\.mp3$/i.test(f.name));
    const mp3s = files.filter((f) => /\.mp3$/i.test(f.name));
    setError(rejected.length ? `Only MP3s can be uploaded; skipped ${rejected.map((f) => f.name).join(', ')}.` : '');
    if (!mp3s.length) return;
    const start = uploads.length;
    setUploads((u) => [...u, ...mp3s.map((f) => ({ name: f.name, progress: 0 }))]);
    // One after another, so versions are numbered in the order the files were chosen.
    for (let i = 0; i < mp3s.length; i++) await uploadOne(mp3s[i], start + i);
  }

  async function remove(t: StudioTrack) {
    setError('');
    const r = await api(`/api/tracks/${t.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setError(r.body.error || 'Could not delete the track.');
      return;
    }
    setTracks((list) => list.filter((x) => x.id !== t.id));
  }

  // The current mix: chosen by hand, else the newest. The rest follow, newest first.
  const latest = tracks.find((t) => t.id === project.currentMixId) ?? tracks[0];
  const earlier = tracks.filter((t) => t !== latest);
  const chosenByHand = !!latest && project.currentMixId === latest.id && latest !== tracks[0];
  const pastNames = nameHistory.filter((n) => n.name !== project.workingName);

  return (
    <div className="mt-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-lg" title="Canonical ID — matches the Ableton folder; permanent">
          {project.canonicalId}
        </span>
        {isOwner && artists.length > 0 ? (
          <label className="text-sm text-muted">
            <span className="sr-only">Artist</span>
            <select
              value={project.artist.id}
              onChange={(e) => patch({ artistId: Number(e.target.value) })}
              title="Artist"
              className="rounded-md border border-line bg-card px-2 py-1 text-xs font-medium tracking-[0.04em] outline-none focus:border-rust"
            >
              {artists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-xs font-medium tracking-[0.04em] text-muted" title={project.artist.name}>
            {project.artist.code}
          </span>
        )}
        {canEdit ? (
          <Stars rating={project.rating} onRate={(n) => patch({ rating: n })} />
        ) : (
          <span className="text-sm text-muted" title="Rating">
            {project.rating ? '★'.repeat(project.rating) : 'unrated'}
          </span>
        )}
      </div>

      {!isOwner && (
        <p className="mt-1 text-xs text-muted">
          Shared by {project.ownerName} · you can{' '}
          {project.level === 'edit' ? 'edit' : project.level === 'contribute' ? 'contribute' : 'listen'}
        </p>
      )}

      <div className="mt-2">
        {canEdit ? (
          <InlineEdit
            value={project.workingName}
            placeholder="untitled"
            label="Working name"
            textClass="font-serif text-2xl sm:text-3xl"
            onSave={(v) => patch({ workingName: v })}
          />
        ) : (
          <h1 className="font-serif text-2xl sm:text-3xl">{project.workingName || 'untitled'}</h1>
        )}
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="text-muted">Genre</dt>
          <dd>
            {canEdit ? (
              <GenreSelect
                value={project.genre}
                genres={genres}
                onAddGenre={addGenre}
                onChange={(g) => patch({ genre: g })}
              />
            ) : (
              project.genre || '—'
            )}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-muted">BPM</dt>
          <dd className="w-20 tabular-nums">
            {canEdit ? (
              <InlineEdit
                value={project.bpm === null ? '' : String(project.bpm)}
                placeholder="—"
                label="BPM"
                inputMode="decimal"
                onSave={(v) => patch({ bpm: v })}
              />
            ) : project.bpm === null ? (
              '—'
            ) : (
              project.bpm
            )}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-muted">Started</dt>
          <dd>{formatDate(project.createdAt)}</dd>
        </div>
      </dl>

      {releases.length > 0 && (
        <p className="mt-3 text-sm">
          <span className="text-muted">On </span>
          {releases.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ', '}
              <Link href={`/collections/${r.id}`} className="underline hover:text-rust">
                {r.title}
              </Link>
            </span>
          ))}
        </p>
      )}

      {pastNames.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">
            Earlier names ({pastNames.length})
          </summary>
          <ul className="mt-2 space-y-1 pl-4">
            {pastNames.map((n, i) => (
              <li key={i} className="text-muted">
                <span className="text-ink">{n.name}</span> · {n.setByName} · {formatDate(n.setAt)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <p className="mt-4 text-sm text-rust">{error}</p>}

      {/* ── Reference tracks ───────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Mixes</h2>

        {latest ? (
          <div className="rounded-lg border border-line bg-card p-4">
            <TrackMeta track={latest} emphasis />
            <p className="mt-1 text-xs text-muted">
              Current mix{chosenByHand ? ', chosen by hand' : ', the newest'}
              {chosenByHand && canEdit && (
                <>
                  {' · '}
                  <button onClick={() => makeCurrent(null)} className="underline hover:text-ink">
                    use the newest instead
                  </button>
                </>
              )}
            </p>
            <audio
              ref={register}
              onPlay={onPlay}
              onLoadedMetadata={lengthProbe(latest)}
              controls
              preload="metadata"
              src={audioUrl(latest)}
              className="mt-3 w-full"
            />
            <TrackActions
              track={latest}
              canDelete={canDelete}
              noteCount={noteCounts.get(latest.id) ?? 0}
              onNotes={() => openNotes(latest)}
              onDelete={() => remove(latest)}
            />
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-card px-4 py-6 text-sm text-muted">No mixes yet.</p>
        )}

        {earlier.length > 0 && (
          <ul className="mt-4 space-y-3">
            {earlier.map((t) => (
              <li key={t.id} className="rounded-md border border-line/70 px-3 py-2 opacity-80 hover:opacity-100">
                <TrackMeta track={t} />
                <audio
                  ref={register}
                  onPlay={onPlay}
                  onLoadedMetadata={lengthProbe(t)}
                  controls
                  preload="none"
                  src={audioUrl(t)}
                  className="mt-2 h-8 w-full"
                />
                <TrackActions
                  track={t}
                  canDelete={canDelete}
                  noteCount={noteCounts.get(t.id) ?? 0}
                  onNotes={() => openNotes(t)}
                  onDelete={() => remove(t)}
                  onMakeCurrent={canEdit ? () => makeCurrent(t) : undefined}
                />
              </li>
            ))}
          </ul>
        )}

        {/* ── Upload ───────────────────────────────────────────────────── */}
        {!canContribute ? null : uploadsEnabled ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              uploadFiles(e.dataTransfer.files);
            }}
            className={`mt-6 rounded-lg border border-dashed px-4 py-6 text-center text-sm ${
              dragging ? 'border-ink bg-card' : 'border-line text-muted'
            }`}
          >
            Drop an MP3 here to add the next version, or{' '}
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
                if (e.target.files) uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        ) : (
          <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            Uploads are off until the audio bucket is configured (R2_AUDIO_BUCKET).
          </p>
        )}

        {uploads.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
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
      </section>

      <References
        projectId={project.id}
        references={references}
        setReferences={setReferences}
        canContribute={canContribute}
        canDelete={canDelete}
        uploadsEnabled={uploadsEnabled}
        register={register}
        onPlay={onPlay}
        lengthProbe={lengthProbe}
      />

      <Notes
        projectId={project.id}
        tracks={tracks}
        notes={notes}
        setNotes={setNotes}
        viewerId={viewerId}
        canContribute={canContribute}
        canDelete={canDelete}
        focus={noteFocus}
      />

      {isOwner && <Sharing sharesUrl={`/api/projects/${project.id}/shares`} initialShares={initialShares} />}
    </div>
  );
}

function TrackMeta({ track: t, emphasis = false }: { track: StudioTrack; emphasis?: boolean }) {
  const details = [
    t.uploadedByName,
    formatDate(t.uploadedAt),
    formatDuration(t.durationS),
    formatBytes(t.bytes),
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <span className={emphasis ? 'font-serif text-xl' : 'text-sm font-medium'}>v{t.version}</span>
      <span className={`min-w-0 truncate ${emphasis ? 'text-sm' : 'text-xs'}`} title={t.originalFilename}>
        {t.originalFilename}
      </span>
      <span className="text-xs text-muted">{details.join(' · ')}</span>
    </div>
  );
}

function TrackActions({
  track,
  canDelete,
  noteCount,
  onNotes,
  onDelete,
  onMakeCurrent,
}: {
  track: StudioTrack;
  canDelete: boolean;
  noteCount: number;
  onNotes: () => void;
  onDelete: () => void;
  /** Absent on the current mix. */
  onMakeCurrent?: () => void;
}) {
  // Two clicks to delete: the first arms the button, the second deletes.
  const [armed, setArmed] = useState(false);
  return (
    <div className="mt-2 flex gap-4 text-xs">
      <a href={audioUrl(track, true)} className="text-muted underline hover:text-ink">
        Download
      </a>
      <button onClick={onNotes} className="text-muted underline hover:text-ink">
        {noteCount ? `Notes (${noteCount})` : 'Add a note'}
      </button>
      {onMakeCurrent && (
        <button onClick={onMakeCurrent} className="text-muted underline hover:text-ink">
          Make current
        </button>
      )}
      {canDelete &&
        (armed ? (
          <span className="flex gap-2">
            <button onClick={onDelete} className="text-rust underline">
              Confirm delete v{track.version}
            </button>
            <button onClick={() => setArmed(false)} className="text-muted hover:text-ink">
              cancel
            </button>
          </span>
        ) : (
          <button onClick={() => setArmed(true)} className="text-muted hover:text-rust">
            Delete
          </button>
        ))}
    </div>
  );
}

// ── References ────────────────────────────────────────────────────────────────

/**
 * Other artists' tracks kept beside the session for comparison. Uploaded the
 * same way as a mix (signed PUT straight to R2), then recorded with a credit.
 * Contributors add them and correct credits; only the owner removes one.
 */
function References({
  projectId,
  references,
  setReferences,
  canContribute,
  canDelete,
  uploadsEnabled,
  register,
  onPlay,
  lengthProbe,
}: {
  projectId: number;
  references: StudioReference[];
  setReferences: React.Dispatch<React.SetStateAction<StudioReference[]>>;
  canContribute: boolean;
  canDelete: boolean;
  uploadsEnabled: boolean;
  register: (el: HTMLAudioElement | null) => void;
  onPlay: (e: React.SyntheticEvent<HTMLAudioElement>) => void;
  lengthProbe: (t: { id: number; durationS: number | null }) => ((e: React.SyntheticEvent<HTMLAudioElement>) => void) | undefined;
}) {
  const [credit, setCredit] = useState('');
  const [busy, setBusy] = useState<{ name: string; progress: number } | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError('');
    if (!/\.mp3$/i.test(file.name)) {
      setError('Only MP3s can be uploaded.');
      return;
    }
    setBusy({ name: file.name, progress: 0 });
    try {
      const signed = await api<{ url: string; key: string }>(`/api/projects/${projectId}/tracks/upload`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, bytes: file.size }),
      });
      if (!signed.ok) throw new Error(signed.body.error || 'Could not start the upload.');
      const durationS = await readDuration(file);
      await putWithProgress(signed.data.url, file, (f) => setBusy({ name: file.name, progress: f }));
      const saved = await api<{ reference: StudioReference }>(`/api/projects/${projectId}/references`, {
        method: 'POST',
        body: JSON.stringify({ key: signed.data.key, filename: file.name, durationS, credit }),
      });
      if (!saved.ok) throw new Error(saved.body.error || 'Uploaded, but could not record the reference.');
      setReferences((list) => [...list, saved.data.reference]);
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
    setReferences((list) => list.map((x) => (x.id === r.id ? res.data.reference : x)));
    return true;
  }

  async function remove(r: StudioReference) {
    setError('');
    const res = await api(`/api/references/${r.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError(res.body.error || 'Could not remove the reference.');
      return;
    }
    setReferences((list) => list.filter((x) => x.id !== r.id));
  }

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">References</h2>
      {references.length === 0 && <p className="text-sm text-muted">No references yet.</p>}
      <ul className="space-y-3">
        {references.map((r) => (
          <li key={r.id} className="rounded-md border border-line/70 px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="min-w-0 flex-1 text-sm font-medium">
                {canContribute ? (
                  <InlineEdit
                    value={r.credit}
                    placeholder={r.originalFilename}
                    label="Credit"
                    onSave={(v) => saveCredit(r, v)}
                  />
                ) : (
                  r.credit || r.originalFilename
                )}
              </span>
              <span className="text-xs text-muted">
                {[r.uploadedByName, formatDate(r.uploadedAt), formatDuration(r.durationS), formatBytes(r.bytes)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <audio
              ref={register}
              onPlay={onPlay}
              onLoadedMetadata={lengthProbe(r)}
              controls
              preload="none"
              src={audioUrl(r)}
              className="mt-2 h-8 w-full"
            />
            <ReferenceActions
              reference={r}
              canDelete={canDelete}
              onDelete={() => remove(r)}
            />
          </li>
        ))}
      </ul>

      {uploadsEnabled && canContribute && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <input
            type="text"
            value={credit}
            onChange={(e) => setCredit(e.target.value)}
            placeholder="Artist — Title"
            aria-label="Credit for the next reference"
            className="w-64 rounded-md border border-line bg-card px-2 py-1 outline-none focus:border-rust"
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={!!busy}
            className="rounded-md border border-line px-3 py-1 hover:border-ink disabled:opacity-50"
          >
            {busy ? `Uploading ${Math.round(busy.progress * 100)}%…` : 'Add a reference MP3'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".mp3,audio/mpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rust">{error}</p>}
    </section>
  );
}

function ReferenceActions({
  reference,
  canDelete,
  onDelete,
}: {
  reference: StudioReference;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="mt-2 flex gap-4 text-xs">
      <a href={audioUrl(reference, true)} className="text-muted underline hover:text-ink">
        Download
      </a>
      {canDelete &&
        (armed ? (
          <span className="flex gap-2">
            <button onClick={onDelete} className="text-rust underline">
              Confirm remove
            </button>
            <button onClick={() => setArmed(false)} className="text-muted hover:text-ink">
              cancel
            </button>
          </span>
        ) : (
          <button onClick={() => setArmed(true)} className="text-muted hover:text-rust">
            Remove
          </button>
        ))}
    </div>
  );
}

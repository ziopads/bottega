'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { StudioArtist, StudioName, StudioNote, StudioProject, StudioRelease, StudioTrack } from '@/lib/studioTypes';
import { formatBytes, formatDuration } from '@/lib/studioTypes';
import { api, GenreSelect, InlineEdit, Stars } from './controls';
import Notes from './Notes';

// One project: its details, its reference MP3s (newest first, older versions
// smaller below), the upload that adds the next version, and its notes.
//
// Upload is two requests around a direct browser → R2 PUT (see
// lib/studioAudio.ts for why the file never passes through the app):
//   1. POST …/tracks/upload   → signed PUT URL + key
//   2. PUT the file to R2      (XHR, for a progress bar)
//   3. POST …/tracks           → the server checks the object and records the version

type Upload = { name: string; progress: number; error?: string };

function audioUrl(t: StudioTrack, download = false) {
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
  releases,
  viewerEmail,
  canDelete,
  uploadsEnabled,
}: {
  initialProject: StudioProject;
  initialTracks: StudioTrack[];
  names: StudioName[];
  artists: StudioArtist[];
  initialGenres: string[];
  initialNotes: StudioNote[];
  releases: StudioRelease[];
  viewerEmail: string;
  canDelete: boolean;
  uploadsEnabled: boolean;
}) {
  const [project, setProject] = useState(initialProject);
  const [tracks, setTracks] = useState(initialTracks);
  const [nameHistory, setNameHistory] = useState(names);
  const [genres, setGenres] = useState(initialGenres);
  const [notes, setNotes] = useState(initialNotes);
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
        { name: r.data.project.workingName, setBy: '', setByCode: 'you', setAt: new Date().toISOString() },
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

  const [latest, ...earlier] = tracks;
  const pastNames = nameHistory.filter((n) => n.name !== project.workingName);

  return (
    <div className="mt-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-lg" title="Canonical ID — matches the Ableton folder; permanent">
          {project.canonicalId}
        </span>
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
        <Stars rating={project.rating} onRate={(n) => patch({ rating: n })} />
      </div>

      <div className="mt-2">
        <InlineEdit
          value={project.workingName}
          placeholder="untitled"
          label="Working name"
          textClass="font-serif text-2xl sm:text-3xl"
          onSave={(v) => patch({ workingName: v })}
        />
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="text-muted">Genre</dt>
          <dd>
            <GenreSelect
              value={project.genre}
              genres={genres}
              onAddGenre={addGenre}
              onChange={(g) => patch({ genre: g })}
            />
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-muted">BPM</dt>
          <dd className="w-20 tabular-nums">
            <InlineEdit
              value={project.bpm === null ? '' : String(project.bpm)}
              placeholder="—"
              label="BPM"
              inputMode="decimal"
              onSave={(v) => patch({ bpm: v })}
            />
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
                <span className="text-ink">{n.name}</span> · {n.setByCode ?? n.setBy} · {formatDate(n.setAt)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <p className="mt-4 text-sm text-rust">{error}</p>}

      {/* ── Reference tracks ───────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Reference tracks</h2>

        {latest ? (
          <div className="rounded-lg border border-line bg-card p-4">
            <TrackMeta track={latest} emphasis />
            <audio
              ref={register}
              onPlay={onPlay}
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
          <p className="rounded-lg border border-line bg-card px-4 py-6 text-sm text-muted">No reference tracks yet.</p>
        )}

        {earlier.length > 0 && (
          <ul className="mt-4 space-y-3">
            {earlier.map((t) => (
              <li key={t.id} className="rounded-md border border-line/70 px-3 py-2 opacity-80 hover:opacity-100">
                <TrackMeta track={t} />
                <audio ref={register} onPlay={onPlay} controls preload="none" src={audioUrl(t)} className="mt-2 h-8 w-full" />
                <TrackActions
                  track={t}
                  canDelete={canDelete}
                  noteCount={noteCounts.get(t.id) ?? 0}
                  onNotes={() => openNotes(t)}
                  onDelete={() => remove(t)}
                />
              </li>
            ))}
          </ul>
        )}

        {/* ── Upload ───────────────────────────────────────────────────── */}
        {uploadsEnabled ? (
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

      <Notes
        projectId={project.id}
        tracks={tracks}
        notes={notes}
        setNotes={setNotes}
        viewerEmail={viewerEmail}
        isAdmin={canDelete}
        focus={noteFocus}
      />
    </div>
  );
}

function TrackMeta({ track: t, emphasis = false }: { track: StudioTrack; emphasis?: boolean }) {
  const details = [
    t.uploadedByCode ?? t.uploadedBy,
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
}: {
  track: StudioTrack;
  canDelete: boolean;
  noteCount: number;
  onNotes: () => void;
  onDelete: () => void;
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

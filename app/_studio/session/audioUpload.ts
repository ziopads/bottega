// Browser only. Uploading an MP3 to a session, as a new version of the mix or
// as a reference: a signed PUT straight to R2 (lib/studioAudio.ts says why
// the file never passes through the app), then the record, then the
// waveform, measured from the file already in memory (REQUIREMENTS S-10).

import { api } from '@/app/_studio/controls';
import { measureAndStore } from '@/lib/peaks';
import type { StudioReference, StudioTrack } from '@/lib/studioTypes';

/** Duration from the file's own metadata, read locally before upload. Null if the browser can't tell. */
export function readDuration(file: File): Promise<number | null> {
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

async function signAndPut(projectId: number, file: File, onProgress: (f: number) => void) {
  const signed = await api<{ url: string; key: string }>(`/api/projects/${projectId}/tracks/upload`, {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, bytes: file.size }),
  });
  if (!signed.ok) throw new Error(signed.body.error || 'Could not start the upload.');
  const durationS = await readDuration(file);
  await putWithProgress(signed.data.url, file, onProgress);
  return { key: signed.data.key, durationS };
}

export async function uploadMix(projectId: number, file: File, onProgress: (f: number) => void): Promise<StudioTrack> {
  const { key, durationS } = await signAndPut(projectId, file, onProgress);
  const saved = await api<{ track: StudioTrack }>(`/api/projects/${projectId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ key, filename: file.name, durationS }),
  });
  if (!saved.ok) throw new Error(saved.body.error || 'Uploaded, but could not record the version.');
  const peaks = await measureAndStore(saved.data.track.id, await file.arrayBuffer());
  return { ...saved.data.track, peaks };
}

export async function uploadReference(
  projectId: number,
  file: File,
  credit: string,
  onProgress: (f: number) => void,
): Promise<StudioReference> {
  const { key, durationS } = await signAndPut(projectId, file, onProgress);
  const saved = await api<{ reference: StudioReference }>(`/api/projects/${projectId}/references`, {
    method: 'POST',
    body: JSON.stringify({ key, filename: file.name, durationS, credit }),
  });
  if (!saved.ok) throw new Error(saved.body.error || 'Uploaded, but could not record the reference.');
  const peaks = await measureAndStore(saved.data.reference.id, await file.arrayBuffer());
  return { ...saved.data.reference, peaks };
}

export function audioUrl(t: { id: number }, download = false) {
  return `/api/tracks/${t.id}/audio${download ? '?download=1' : ''}`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

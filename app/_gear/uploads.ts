// Browser only. Uploads for gear (REQUIREMENTS G-10): an image becomes its
// web versions here and goes into a folder of its own; a PDF goes up as it
// is. Each follows the routes' two steps: ask for signed PUTs, put, record.

import { api } from '@/app/_studio/controls';
import type { GearFile, GearFileRole } from '@/lib/gearTypes';
import { prepareImage, type PreparedImage } from '@/lib/imagePrep';

function put(url: string, body: Blob, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the upload (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('The upload could not reach storage (network or CORS).'));
    xhr.send(body);
  });
}

async function putVariants(prepared: PreparedImage, urls: Record<string, string>): Promise<void> {
  for (const v of prepared.variants) await put(urls[v.file], v.blob, v.contentType);
}

const sizes = (p: PreparedImage) => p.variants.map((v) => ({ file: v.file, bytes: v.blob.size }));

export async function uploadImage(
  gearId: number,
  file: File,
  role: GearFileRole,
  onStep: (step: 'preparing' | 'uploading') => void,
): Promise<GearFile> {
  onStep('preparing');
  const prepared = await prepareImage(file);
  onStep('uploading');
  const signed = await api<{ folder: string; urls: Record<string, string> }>(`/api/gear/${gearId}/images/upload`, {
    method: 'POST',
    body: JSON.stringify({ role, variants: sizes(prepared) }),
  });
  if (!signed.ok) throw new Error(signed.body.error || 'Could not start the upload.');
  await putVariants(prepared, signed.data.urls);
  const saved = await api<{ file: GearFile }>(`/api/gear/${gearId}/images`, {
    method: 'POST',
    body: JSON.stringify({
      folder: signed.data.folder,
      variants: prepared.variants.map((v) => v.file),
      filename: file.name,
      role,
      width: prepared.width,
      height: prepared.height,
    }),
  });
  if (!saved.ok) throw new Error(saved.body.error || 'Uploaded, but could not record the image.');
  return saved.data.file;
}

export async function uploadDocument(gearId: number, file: File, role: GearFileRole): Promise<GearFile> {
  const contentType = file.type || 'application/pdf';
  const signed = await api<{ url: string; key: string }>(`/api/gear/${gearId}/files/upload`, {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, contentType, bytes: file.size, role }),
  });
  if (!signed.ok) throw new Error(signed.body.error || 'Could not start the upload.');
  await put(signed.data.url, file, contentType);
  const saved = await api<{ file: GearFile }>(`/api/gear/${gearId}/files`, {
    method: 'POST',
    body: JSON.stringify({ key: signed.data.key, filename: file.name, role }),
  });
  if (!saved.ok) throw new Error(saved.body.error || 'Uploaded, but could not record the file.');
  return saved.data.file;
}

/** Turns an older image (stored as its original) into web versions, from the original. */
export async function convertImage(fileId: number, filename: string): Promise<GearFile> {
  // The app route redirects to a signed link for the original; R2 allows the
  // GET from this origin (the bucket's CORS rule).
  const res = await fetch(`/api/gear-files/${fileId}?download=1`);
  if (!res.ok) throw new Error(`Could not fetch the original (${res.status}).`);
  const original = new File([await res.blob()], filename, { type: res.headers.get('content-type') ?? '' });
  const prepared = await prepareImage(original);
  const signed = await api<{ folder: string; urls: Record<string, string> }>(`/api/gear-files/${fileId}/convert`, {
    method: 'PUT',
    body: JSON.stringify({ variants: sizes(prepared) }),
  });
  if (!signed.ok) throw new Error(signed.body.error || 'Could not start the conversion.');
  await putVariants(prepared, signed.data.urls);
  const saved = await api<{ file: GearFile }>(`/api/gear-files/${fileId}/convert`, {
    method: 'POST',
    body: JSON.stringify({
      folder: signed.data.folder,
      variants: prepared.variants.map((v) => v.file),
      width: prepared.width,
      height: prepared.height,
    }),
  });
  if (!saved.ok) throw new Error(saved.body.error || 'Converted, but could not record it.');
  return saved.data.file;
}

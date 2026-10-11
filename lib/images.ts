import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { fileObject, filesConfigured } from '@/lib/files';
import { IMAGE_VARIANTS, VARIANT_FILE, VARIANT_TYPES, type ImageUrls, type VariantName } from '@/lib/imageTypes';
import { getClient } from '@/lib/storage';

// Server-only. Image folders in the files bucket (REQUIREMENTS G-10, db/007,
// ARCHITECTURE §12):
//
//   a/<owner>/gear/<unit>/<image id>/thumb.webp | view.webp | full.webp
//
// Links are signed while the page renders, so the browser goes straight to
// R2 with no request to the app per image. Each link is signed as of the
// start of the current hour and valid for two, so the same image has the same
// link all hour and the browser's cache can serve it.

const filesBucket = process.env.R2_FILES_BUCKET || '';
const WINDOW_SECONDS = 60 * 60;

export function newImageFolder(ownerId: string, unitId: number): string {
  return `a/${ownerId}/gear/${unitId}/${randomUUID()}/`;
}

/** A folder the app issued for this owner and unit, and nothing else. */
export function isImageFolder(key: string, ownerId: string, unitId: number): boolean {
  const prefix = `a/${ownerId}/gear/${unitId}/`;
  return key.startsWith(prefix) && /^[0-9a-f-]{36}\/$/.test(key.slice(prefix.length));
}

/** Variant file names for one image: one per size, each a known name and type. */
export function validVariantSet(files: unknown): files is string[] {
  if (!Array.isArray(files) || files.length !== IMAGE_VARIANTS.length) return false;
  const names = files.map((f) => (typeof f === 'string' && VARIANT_FILE.test(f) ? f.split('.')[0] : null));
  return IMAGE_VARIANTS.every((v) => names.includes(v.name));
}

export function variantType(file: string): string {
  return VARIANT_TYPES[file.split('.')[1]] ?? 'application/octet-stream';
}

export function variantLimit(file: string): number {
  return IMAGE_VARIANTS.find((v) => v.name === file.split('.')[0])?.maxBytes ?? 0;
}

/**
 * Reads back each variant of an uploaded image and returns their total size,
 * or the reason the upload is refused (missing, wrong type, too large).
 */
export async function checkStoredVariants(folder: string, files: string[]): Promise<{ bytes: number } | { error: string }> {
  let bytes = 0;
  for (const file of files) {
    const stored = await fileObject(folder + file);
    if (!stored) return { error: `The upload of ${file} did not reach storage. Please try again.` };
    if (stored.contentType !== variantType(file)) return { error: `${file} is not the type it claims to be.` };
    if (stored.bytes > variantLimit(file)) return { error: `${file} is larger than allowed.` };
    bytes += stored.bytes;
  }
  return { bytes };
}

function windowStart(): Date {
  const now = Math.floor(Date.now() / 1000);
  return new Date((now - (now % WINDOW_SECONDS)) * 1000);
}

/** Signed links for each size of an image folder, stable within the hour. */
export async function imageUrls(folder: string, files: string[]): Promise<ImageUrls | null> {
  if (!filesConfigured() || !files.length) return null;
  const signingDate = windowStart();
  const out: Partial<ImageUrls> = {};
  for (const file of files) {
    const name = file.split('.')[0] as VariantName;
    out[name] = await getSignedUrl(
      getClient(),
      new GetObjectCommand({
        Bucket: filesBucket,
        Key: folder + file,
        ResponseContentType: variantType(file),
        ResponseCacheControl: `private, max-age=${WINDOW_SECONDS}`,
      }),
      { expiresIn: 2 * WINDOW_SECONDS, signingDate },
    );
  }
  return out.thumb && out.view && out.full ? (out as ImageUrls) : null;
}

/** A 10-minute link that saves the full version under the original's name. */
export async function imageDownloadUrl(folder: string, files: string[], filename: string): Promise<string | null> {
  const full = files.find((f) => f.startsWith('full.'));
  if (!full) return null;
  const base = filename.replace(/\.[^.]+$/, '') || 'image';
  const name = `${base}.${full.split('.')[1]}`.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: filesBucket,
      Key: folder + full,
      ResponseContentType: variantType(full),
      ResponseContentDisposition: `attachment; filename="${name}"`,
    }),
    { expiresIn: 600 },
  );
}

/** Deletes a gear file's objects: every variant of a folder, or the single file. */
export async function deleteGearObjects(key: string, variants: string[]): Promise<void> {
  const keys = variants.length ? variants.map((v) => key + v) : [key];
  for (const k of keys) {
    await getClient().send(new DeleteObjectCommand({ Bucket: filesBucket, Key: k }));
  }
}

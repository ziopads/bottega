import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { getClient, r2Configured } from './storage';

// Server-only. Every upload other than audio, in the private files bucket
// (R2_FILES_BUCKET): gear photos, receipts and serial plates now; project
// images, private documents and library manuals as they arrive. The rules are
// ARCHITECTURE §12:
//
//   - keys are a/<owner account id>/<kind>/<item id>/<uuid>.<ext>; documents,
//     which get their row only once the upload has landed, are
//     a/<owner>/documents/<uuid>.pdf or library/<uuid>.pdf; nothing
//     personal in any of them;
//   - the browser uploads by a signed PUT and only ever holds short-lived
//     signed links, minted after the route has authorized the request;
//   - an upload is recorded only once the app has read its size and type back
//     from R2;
//   - images may open inline; everything else downloads.

const filesBucket = process.env.R2_FILES_BUCKET || '';

export const FILE_MAX_BYTES = 50 * 1024 * 1024;
/**
 * Documents for the corpus (K-1): manuals and books run larger than gear files,
 * and a scanned or image-heavy book can pass 50 MB even compressed. The
 * account's storage allowance (K-10) still bounds what one person stores, and
 * only extraction reads the whole file, 300 pages per step.
 */
export const DOCUMENT_MAX_BYTES = 150 * 1024 * 1024;
const PUT_TTL_SECONDS = 15 * 60;
const GET_TTL_SECONDS = 10 * 60;

/** Accepted types and the extension each is stored under. SVG and HTML are never accepted. */
export const FILE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

export function filesConfigured(): boolean {
  return r2Configured() && !!filesBucket;
}

export type FileKind = 'gear' | 'projects' | 'documents';

/** a/<owner>/<kind>/<item>/<uuid>.<ext> — the owner's prefix, whoever uploads. */
export function newAccountFileKey(ownerId: string, kind: FileKind, itemId: number, contentType: string): string {
  const ext = FILE_TYPES[contentType];
  if (!ext) throw new Error(`newAccountFileKey: ${contentType} is not an accepted type`);
  return `a/${ownerId}/${kind}/${itemId}/${randomUUID()}.${ext}`;
}

/** A key the app issued for this owner, kind and item, and nothing else. */
export function isAccountFileKey(key: string, ownerId: string, kind: FileKind, itemId: number): boolean {
  const prefix = `a/${ownerId}/${kind}/${itemId}/`;
  if (!key.startsWith(prefix)) return false;
  return /^[0-9a-f-]{36}\.(jpg|png|webp|heic|pdf)$/.test(key.slice(prefix.length));
}

/** A new document's key: under its owner's prefix, or the library's. */
export function newDocumentKey(ownerId: string | null): string {
  return ownerId ? `a/${ownerId}/documents/${randomUUID()}.pdf` : `library/${randomUUID()}.pdf`;
}

/** A document key the app issued for this owner (or the library), and nothing else. */
export function isDocumentKey(key: string, ownerId: string | null): boolean {
  const prefix = ownerId ? `a/${ownerId}/documents/` : 'library/';
  return key.startsWith(prefix) && /^[0-9a-f-]{36}\.pdf$/.test(key.slice(prefix.length));
}

/** The whole object, for processing on the server. */
export async function getFileBytes(key: string): Promise<Uint8Array> {
  const res = await getClient().send(new GetObjectCommand({ Bucket: filesBucket, Key: key }));
  if (!res.Body) throw new Error(`getFileBytes: ${key} has no body`);
  return res.Body.transformToByteArray();
}

export async function signFileUpload(key: string, contentType: string): Promise<string> {
  // ContentType is part of the signature: the browser must send exactly it.
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: filesBucket, Key: key, ContentType: contentType }),
    { expiresIn: PUT_TTL_SECONDS },
  );
}

/** Size and type of an uploaded object as R2 has it, or null if it is not there. */
export async function fileObject(key: string): Promise<{ bytes: number; contentType: string } | null> {
  try {
    const head = await getClient().send(new HeadObjectCommand({ Bucket: filesBucket, Key: key }));
    return { bytes: head.ContentLength ?? 0, contentType: head.ContentType ?? '' };
  } catch (err: unknown) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw err;
  }
}

function disposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** A 10-minute link. Images open inline unless a download is asked for; anything else downloads. */
export async function signFileGet(
  key: string,
  opts: { filename: string; contentType: string; download?: boolean; inline?: boolean },
): Promise<string> {
  // Images open inline; a PDF does when asked (the page reader shows it in a frame).
  const inline = !opts.download && (opts.contentType.startsWith('image/') || (opts.inline === true && opts.contentType === 'application/pdf'));
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: filesBucket,
      Key: key,
      ResponseContentType: opts.contentType || 'application/octet-stream',
      ResponseContentDisposition: disposition(inline ? 'inline' : 'attachment', opts.filename),
    }),
    { expiresIn: GET_TTL_SECONDS },
  );
}

// The page reader's link to a document, signed for a fixed window rather than
// from the moment of asking: every request in the same six hours gets the same
// address, so the browser can keep the file in its cache and a page refresh
// does not download a large book again. The link stays valid for up to twelve
// hours after its window opens, longer than the ten minutes of an ordinary
// link; the reader is only reached after the database has said the person may
// read the document.
const READER_WINDOW_SECONDS = 6 * 60 * 60;

export async function signReaderGet(key: string, opts: { filename: string; contentType: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = new Date((now - (now % READER_WINDOW_SECONDS)) * 1000);
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: filesBucket,
      Key: key,
      ResponseContentType: opts.contentType || 'application/octet-stream',
      ResponseContentDisposition: disposition('inline', opts.filename),
      ResponseCacheControl: `private, max-age=${READER_WINDOW_SECONDS}`,
    }),
    { expiresIn: 2 * READER_WINDOW_SECONDS, signingDate: windowStart },
  );
}

export async function deleteFile(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: filesBucket, Key: key }));
}

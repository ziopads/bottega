import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getClient, r2Configured } from './storage';

// Server-only. Reference MP3s in the PRIVATE audio bucket (R2_AUDIO_BUCKET).
//
// Nothing in this bucket has a public URL. The browser only ever holds
// short-lived signed links:
//
//   upload    a signed PUT, so the file goes straight from the browser to R2.
//             Vercel functions refuse request bodies over ~4.5 MB, which is
//             smaller than most reference mixes, so the file cannot pass
//             through the app.
//   playback  a signed GET, reached through /api/studio/tracks/:id/audio,
//             which checks the session and redirects. The <audio> element
//             follows the redirect and sends its range requests to R2 itself.
//   download  the same signed GET with a Content-Disposition override, so the
//             file saves under a readable name instead of its storage key.
//
// The bucket needs a CORS rule allowing PUT from the studio's origin, or the
// browser upload fails with a CORS error before any request reaches R2.

const audioBucket = process.env.R2_AUDIO_BUCKET || '';

export const AUDIO_MAX_BYTES = 200 * 1024 * 1024;
export const AUDIO_CONTENT_TYPE = 'audio/mpeg';

/** Upload links are short: they only need to outlive one upload starting. */
const PUT_TTL_SECONDS = 15 * 60;
/** Playback links must outlast a long listen, including seeks near the end. */
const GET_TTL_SECONDS = 6 * 60 * 60;

export function audioConfigured(): boolean {
  return r2Configured() && !!audioBucket;
}

/** studio/<projectId>/<uuid>.mp3 — random, so a key can never be guessed or collide. */
export function newAudioKey(projectId: number): string {
  return `studio/${projectId}/${randomUUID()}.mp3`;
}

/** A key the app issued for this project, and nothing else. */
export function isKeyForProject(key: string, projectId: number): boolean {
  return new RegExp(`^studio/${projectId}/[0-9a-f-]{36}\\.mp3$`).test(key);
}

export async function signAudioUpload(key: string): Promise<string> {
  // ContentType is part of the signature, so the browser must send exactly
  // this Content-Type header or R2 rejects the PUT.
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: audioBucket, Key: key, ContentType: AUDIO_CONTENT_TYPE }),
    { expiresIn: PUT_TTL_SECONDS },
  );
}

/** Size of an uploaded object, or null if it is not there. */
export async function audioObjectSize(key: string): Promise<number | null> {
  try {
    const head = await getClient().send(new HeadObjectCommand({ Bucket: audioBucket, Key: key }));
    return head.ContentLength ?? null;
  } catch (err: unknown) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw err;
  }
}

/**
 * RFC 6266 Content-Disposition. The plain `filename` is an ASCII fallback; the
 * `filename*` form carries the real name, accents and all.
 */
function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function signAudioGet(key: string, downloadName?: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: audioBucket,
      Key: key,
      ResponseContentType: AUDIO_CONTENT_TYPE,
      ...(downloadName ? { ResponseContentDisposition: attachment(downloadName) } : {}),
    }),
    { expiresIn: GET_TTL_SECONDS },
  );
}

export async function deleteAudio(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: audioBucket, Key: key }));
}

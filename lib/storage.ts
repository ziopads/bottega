import { S3Client } from '@aws-sdk/client-s3';

// Server-only. The Cloudflare R2 (S3-compatible) client, shared by every
// bucket. Ported from Vivarium, where this file also held the public image
// bucket; Bottega has only private buckets, each named by its own variable
// (R2_AUDIO_BUCKET in lib/studioAudio.ts).

const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';

/** The account and credentials are set. Each bucket checks its own name. */
export function r2Configured(): boolean {
  return !!(accountId && accessKeyId && secretAccessKey);
}

let client: S3Client | null = null;

export function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

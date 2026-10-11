import type { Scoped } from '@/lib/db';

// What the signed-in person stores, by kind (REQUIREMENTS O-7, db/007
// my_usage). The kinds add up to storage_used(), which the allowance checks.

export type UsageKind = 'audio' | 'gear images' | 'gear documents' | 'private documents' | 'library submissions';

export const USAGE_LABEL: Record<UsageKind, string> = {
  audio: 'Audio',
  'gear images': 'Gear photos',
  'gear documents': 'Gear documents',
  'private documents': 'Private documents',
  'library submissions': 'Library submissions awaiting review',
};

export interface UsageRow {
  kind: UsageKind;
  files: number;
  bytes: number;
}

export async function getUsage(db: Scoped): Promise<UsageRow[]> {
  const rows = await db.q('select kind, files, bytes from my_usage()');
  return rows.map((r) => ({ kind: String(r.kind) as UsageKind, files: Number(r.files), bytes: Number(r.bytes) }));
}

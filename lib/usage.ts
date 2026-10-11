import type { Scoped } from '@/lib/db';

// What the signed-in person stores, by kind (REQUIREMENTS O-7, db/007
// my_usage). The kinds add up to storage_used(), which the allowance checks.

export type UsageKind = 'audio' | 'gear images' | 'gear documents' | 'private documents' | 'library submissions';

export const USAGE_KINDS: UsageKind[] = ['audio', 'gear images', 'gear documents', 'private documents', 'library submissions'];

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

/** One stored file, for the list under a kind on the account page. */
export interface UsageFile {
  id: number;
  name: string;
  /** Where it lives: the session, unit or document title. */
  where: string;
  href: string;
  bytes: number;
}

// One query per kind, each limited to what my_usage() counts for the person,
// so the files listed are the ones the totals add up. Largest first.
const LARGEST: Record<UsageKind, string> = {
  audio: `
    select a.id, a.original_filename as name, a.bytes,
           coalesce(nullif(btrim(concat_ws(' · ', mp.canonical_id, nullif(p.title, ''))), ''), 'untitled')
             || case when a.role = 'mix' then ' · v' || a.version else ' · reference' end as place,
           '/projects/' || p.id || '?tab=mixes' as href
      from audio a join projects p on p.id = a.project_id left join music_projects mp on mp.project_id = p.id
     where p.owner_id = app_user()`,
  'gear images': `
    select f.id, f.filename as name, f.bytes,
           coalesce(nullif(g.nickname, ''), btrim(coalesce(m.manufacturer, g.manufacturer) || ' ' || coalesce(m.model, g.name))) as place,
           '/gear/' || g.id as href
      from gear_files f join gear g on g.id = f.gear_id left join gear_models m on m.id = g.model_id
     where g.owner_id = app_user() and f.content_type like 'image/%'`,
  'gear documents': `
    select f.id, f.filename as name, f.bytes,
           coalesce(nullif(g.nickname, ''), btrim(coalesce(m.manufacturer, g.manufacturer) || ' ' || coalesce(m.model, g.name))) as place,
           '/gear/' || g.id as href
      from gear_files f join gear g on g.id = f.gear_id left join gear_models m on m.id = g.model_id
     where g.owner_id = app_user() and f.content_type not like 'image/%'`,
  'private documents': `
    select d.id, d.filename as name, d.bytes, d.title as place, '/library/' || d.id as href
      from documents d where d.owner_id = app_user()`,
  'library submissions': `
    select d.id, d.filename as name, d.bytes, d.title as place, '/library/' || d.id as href
      from documents d where d.library and d.contributed_by = app_user() and d.review_status <> 'approved'`,
};

export const LARGEST_PAGE = 10;

export async function listLargest(
  db: Scoped,
  kind: UsageKind,
  offset = 0,
): Promise<{ files: UsageFile[]; more: boolean }> {
  // One extra row says whether there is another page.
  const rows = await db.q(
    `${LARGEST[kind]} order by bytes desc nulls last, id limit $1 offset $2`,
    [LARGEST_PAGE + 1, offset],
  );
  return {
    files: rows.slice(0, LARGEST_PAGE).map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      where: String(r.place ?? ''),
      href: String(r.href),
      bytes: Number(r.bytes ?? 0),
    })),
    more: rows.length > LARGEST_PAGE,
  };
}

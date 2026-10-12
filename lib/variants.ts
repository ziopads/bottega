import type { Scoped } from '@/lib/db';
import type { StudioVariant } from '@/lib/studioTypes';
import { VARIANT_MAX } from '@/lib/studioTypes';

// A session's variants (db/015, REQUIREMENTS S-14, S-16): the main mix, which
// has no row and the empty name, and named variants such as "Radio edit".
// Each variant has its own mixes and its own saved Live sets; a save joins a
// variant when the variant's name rule appears in its file name, or by hand.
// The database sorts the saves; this module reads and changes the list.

export const RULE_MAX = 60;

function pgError(err: unknown): { code?: string; message: string } {
  const e = err as { code?: string; message?: string };
  return { code: e?.code, message: e?.message ?? '' };
}

export async function listVariants(db: Scoped, projectId: number): Promise<StudioVariant[]> {
  const rows = await db.q(
    `select v.id, v.name, v.match,
            (select count(*) from audio a where a.project_id = v.project_id and a.role = 'mix' and a.variant = v.name) as mixes,
            (select count(*) from als_snapshots s where s.project_id = v.project_id and s.variant = v.name) as saves
       from session_variants v where v.project_id = $1 order by v.created_at, v.id`,
    [projectId],
  );
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name), match: String(r.match), mixes: Number(r.mixes), saves: Number(r.saves) }));
}

/** A variant's name and rule as typed; the rule defaults to the name. */
export function parseVariantInput(rawName: unknown, rawMatch: unknown): { name: string; match: string } | { error: string } {
  const name = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { error: 'Name the variant.' };
  if (name.length > VARIANT_MAX) return { error: `Keep the name under ${VARIANT_MAX} characters.` };
  if (['main', 'main mix'].includes(name.toLowerCase())) return { error: 'The main mix is always there; name the variant something else.' };
  const typed = typeof rawMatch === 'string' ? rawMatch.trim().replace(/\s+/g, ' ') : '';
  const match = typed || name.toLowerCase();
  if (match.length > RULE_MAX) return { error: `Keep the name rule under ${RULE_MAX} characters.` };
  return { name, match };
}

export type VariantResult = { ok: true; variants: StudioVariant[] } | { ok: false; error: string; status: number };

export async function createVariant(db: Scoped, projectId: number, name: string, match: string): Promise<VariantResult> {
  try {
    await db.q('insert into session_variants (project_id, name, match) values ($1, $2, $3)', [projectId, name, match]);
  } catch (err) {
    if (pgError(err).code === '23505') return { ok: false, error: `This session already has a variant called “${name}”.`, status: 409 };
    throw err;
  }
  return { ok: true, variants: await listVariants(db, projectId) };
}

export async function renameVariant(db: Scoped, projectId: number, id: number, name: string, match: string): Promise<VariantResult> {
  try {
    const rows = await db.q('select 1 from session_variants where id = $1 and project_id = $2', [id, projectId]);
    if (!rows.length) return { ok: false, error: 'Not found', status: 404 };
    await db.q('select rename_session_variant($1, $2, $3)', [id, name, match]);
  } catch (err) {
    const e = pgError(err);
    if (e.code === '23505') return { ok: false, error: `This session already has a variant called “${name}”.`, status: 409 };
    if (e.code === '42501') return { ok: false, error: 'Edit access is needed to rename a variant.', status: 403 };
    throw err;
  }
  return { ok: true, variants: await listVariants(db, projectId) };
}

export async function deleteVariant(db: Scoped, projectId: number, id: number): Promise<VariantResult> {
  try {
    const rows = await db.q('select 1 from session_variants where id = $1 and project_id = $2', [id, projectId]);
    if (!rows.length) return { ok: false, error: 'Not found', status: 404 };
    await db.q('select delete_session_variant($1)', [id]);
  } catch (err) {
    const e = pgError(err);
    if (e.code === '23503' || e.code === '42501') return { ok: false, error: e.message, status: e.code === '42501' ? 403 : 409 };
    throw err;
  }
  return { ok: true, variants: await listVariants(db, projectId) };
}

/** Puts a save in a variant by hand, or (variant null) hands it back to the name rules. */
export async function moveSave(db: Scoped, projectId: number, snapshotId: number, variant: string | null): Promise<'moved' | 'not-found' | 'unknown-variant'> {
  try {
    const rows = await db.q(
      variant === null
        ? 'update als_snapshots set variant_by_hand = false where id = $1 and project_id = $2 returning id'
        : 'update als_snapshots set variant = $3, variant_by_hand = true where id = $1 and project_id = $2 returning id',
      variant === null ? [snapshotId, projectId] : [snapshotId, projectId, variant],
    );
    return rows.length ? 'moved' : 'not-found';
  } catch (err) {
    if (pgError(err).code === '23503') return 'unknown-variant';
    throw err;
  }
}

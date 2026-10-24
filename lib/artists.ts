import type { Scoped } from '@/lib/db';
import { accountNames, nameOf } from '@/lib/names';
import type { ArtistSetting, ArtistSettingsData, TemplateOption } from '@/lib/artistTypes';

// Artists' templates and sharing (REQUIREMENTS W-30 to W-32, db/028): the
// person's own artists and those shared with them, the templates each starts
// projects with, and who each is shared with. artist_set_templates() and the
// shares policies decide who may change what.

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const idOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** A refusal a person can read. */
export class ArtistError extends Error {}

function options(rows: Row[], me: string): TemplateOption[] {
  return rows.map((r) => ({
    id: num(r.id),
    name: String(r.name),
    note: r.owner_id === null ? 'Bottega default' : String(r.owner_id) === me ? 'yours' : 'shared through an artist',
  }));
}

export async function listArtistSettings(db: Scoped): Promise<ArtistSettingsData> {
  const [artistRows, templateRows, structureRows] = await db.tx([
    {
      text: `select a.id, a.code, a.name, a.account_id, a.workflow_template_id, a.structure_template_id, artist_rank(a.id) as rank
               from artists a
              where a.account_id = app_user()
                 or exists (select 1 from shares s where s.artist_id = a.id and s.grantee_id = app_user())
              order by a.account_id = app_user() desc, a.code`,
    },
    { text: `select id, name, owner_id from workflow_templates where kind = 'music' order by owner_id is null, lower(name)` },
    { text: `select id, name, owner_id from structure_templates order by owner_id is null, lower(name)` },
  ]);
  const ids = artistRows.map((r) => num(r.id));
  const shareRows = ids.length
    ? await db.q('select id, artist_id, grantee_id, level from shares where artist_id = any($1::bigint[]) order by granted_at', [ids])
    : [];
  const who = await accountNames(db, [...artistRows.map((r) => String(r.account_id)), ...shareRows.map((r) => String(r.grantee_id))]);
  const me = db.person.userId;
  const artists: ArtistSetting[] = artistRows.map((r) => {
    const rank = num(r.rank);
    return {
      id: num(r.id),
      code: String(r.code),
      name: String(r.name),
      mine: String(r.account_id) === me,
      ownerName: nameOf(who, String(r.account_id)),
      level: rank >= 4 ? 'owner' : rank >= 3 ? 'edit' : 'view',
      workflowTemplateId: idOrNull(r.workflow_template_id),
      structureTemplateId: idOrNull(r.structure_template_id),
      shares: shareRows
        .filter((s) => num(s.artist_id) === num(r.id))
        .map((s) => ({ id: num(s.id), granteeName: nameOf(who, String(s.grantee_id)), level: s.level === 'edit' ? 'edit' : 'view' })),
    };
  });
  return { artists, workflowTemplates: options(templateRows, me), structures: options(structureRows, me) };
}

/** Sets the templates an artist's projects start with; null is the account's from Preferences. */
export async function setArtistTemplates(db: Scoped, artistId: number, workflowId: number | null, structureId: number | null): Promise<void> {
  try {
    await db.q('select artist_set_templates($1, $2, $3)', [artistId, workflowId, structureId]);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? '';
    if (/needs edit access|not one you can use/.test(msg)) throw new ArtistError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
    throw err;
  }
}

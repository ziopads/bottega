import type { Scoped } from '@/lib/db';
import type { StructureEditor, StructureElement, StructureSummary } from '@/lib/structureTypes';

// Track structures in Preferences (REQUIREMENTS W-25 to W-29; db/025): one's
// own are edited directly; the platform default is read only and copied with
// structure_copy() first. Row-level security keeps every write to one's own.

const num = (v: unknown): number => Number(v);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** A refusal a person can read. */
export class StructureError extends Error {}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { message?: string; code?: string };
    const msg = e?.message ?? '';
    if (e?.code === '23505') throw new StructureError('You already have a structure with that name.');
    if (/not one you can copy|must be one of your own|needs an active account|only a top-level|parts sit|sits under/.test(msg)) {
      throw new StructureError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
    }
    if (/row-level security|permission denied/.test(msg)) throw new StructureError('Only your own structures can be changed. Make a copy first.');
    if (/violates check constraint/.test(msg)) throw new StructureError('That is too long, empty, or repeats a prefix.');
    throw err;
  }
}

export async function getStructureEditor(db: Scoped): Promise<StructureEditor> {
  const [prefRows, tplRows] = await db.tx([
    { text: 'select structure_template_id from account_preferences where user_id = app_user()', params: [] },
    {
      text: `select id, name, owner_id is null as is_default from structure_templates
              where owner_id is null or owner_id = app_user() order by owner_id is not null, lower(name)`,
      params: [],
    },
  ]);
  const templates: StructureSummary[] = tplRows.map((r) => ({ id: num(r.id), name: String(r.name), isDefault: r.is_default === true }));
  const def = templates.find((t) => t.isDefault)!;
  const chosenId = prefRows[0]?.structure_template_id ? num(prefRows[0].structure_template_id) : def.id;
  const chosen = templates.find((t) => t.id === chosenId) ?? def;
  const [rows, defRows] = await db.tx([
    {
      text: `select id, parent_id, uid, position, name, description, color, is_zone, prefixes, group_names
               from structure_elements where template_id = $1 order by position, id`,
      params: [chosen.id],
    },
    { text: 'select uid, name, description, color, is_zone, prefixes, group_names from structure_elements where template_id = $1', params: [def.id] },
  ]);
  const defs = new Map(defRows.map((r) => [String(r.uid), r]));
  const tops = rows.filter((r) => r.parent_id === null);
  const elements: StructureElement[] = tops.map((r) => {
    const d = defs.get(String(r.uid));
    const same =
      d &&
      d.name === r.name &&
      d.description === r.description &&
      (d.color ?? null) === (r.color ?? null) &&
      d.is_zone === r.is_zone &&
      JSON.stringify(list(d.prefixes)) === JSON.stringify(list(r.prefixes)) &&
      JSON.stringify(list(d.group_names)) === JSON.stringify(list(r.group_names));
    return {
      id: num(r.id),
      uid: String(r.uid),
      position: num(r.position),
      name: String(r.name),
      description: String(r.description ?? ''),
      color: r.color === null ? null : String(r.color),
      isZone: r.is_zone === true,
      prefixes: list(r.prefixes),
      groupNames: list(r.group_names),
      parts: rows
        .filter((p) => num(p.parent_id) === num(r.id))
        .map((p) => ({ id: num(p.id), uid: String(p.uid), position: num(p.position), name: String(p.name), description: String(p.description ?? '') })),
      difference: chosen.isDefault ? 'same' : !d ? 'added' : same ? 'same' : 'changed',
    };
  });
  return { chosen, templates, elements };
}

const setPref = (db: Scoped, id: number | null) =>
  db.q(
    `insert into account_preferences (structure_template_id) values ($1)
     on conflict (user_id) do update set structure_template_id = excluded.structure_template_id`,
    [id],
  );

export async function chooseStructure(db: Scoped, id: number | null): Promise<void> {
  await run(() => setPref(db, id));
}

export async function copyStructure(db: Scoped, sourceId: number, name: string): Promise<void> {
  await run(async () => {
    const rows = await db.q('select structure_copy($1, $2) as id', [sourceId, name]);
    await setPref(db, num(rows[0].id));
  });
}

export async function renameStructure(db: Scoped, id: number, name: string): Promise<void> {
  await run(() => db.q('update structure_templates set name = $2 where id = $1', [id, name]));
}

export async function deleteStructure(db: Scoped, id: number): Promise<void> {
  await run(() => db.q('delete from structure_templates where id = $1 and owner_id = app_user()', [id]));
}

/** A top-level element at the end; with a parent, a part at the end of that element's parts. */
export async function addStructureElement(db: Scoped, templateId: number, parentId: number | null, name: string): Promise<void> {
  await run(() =>
    db.q(
      `insert into structure_elements (template_id, parent_id, position, name)
       values ($1, $2, (select coalesce(max(position), 0) + 1 from structure_elements
                         where template_id = $1 and parent_id is not distinct from $2), $3)`,
      [templateId, parentId, name],
    ),
  );
}

export type ElementPatch = Partial<{ name: string; description: string; color: string | null; isZone: boolean; prefixes: string[]; groupNames: string[] }>;

export async function updateStructureElement(db: Scoped, id: number, patch: ElementPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.description !== undefined) add('description', patch.description);
  if (patch.color !== undefined) add('color', patch.color);
  if (patch.isZone !== undefined) {
    add('is_zone', patch.isZone);
    // An element that is no zone matches no tracks.
    if (!patch.isZone) sets.push(`prefixes = '{}'`, `group_names = '{}'`);
  }
  if (patch.prefixes !== undefined && patch.isZone !== false) add('prefixes', patch.prefixes);
  if (patch.groupNames !== undefined && patch.isZone !== false) add('group_names', patch.groupNames);
  if (!sets.length) return;
  await run(() => db.q(`update structure_elements set ${sets.join(', ')} where id = $1`, params));
}

/** Swaps an element with its neighbour among its siblings, renumbering them from 1. */
export async function moveStructureElement(db: Scoped, id: number, dir: -1 | 1): Promise<void> {
  await run(async () => {
    const rows = await db.q(
      `select s.id from structure_elements s, structure_elements me
        where me.id = $1 and s.template_id = me.template_id and s.parent_id is not distinct from me.parent_id
        order by s.position, s.id`,
      [id],
    );
    const ids = rows.map((r) => num(r.id));
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await db.tx(ids.map((x, k) => ({ text: 'update structure_elements set position = $2 where id = $1 and position <> $2', params: [x, k + 1] })));
  });
}

/** Removes an element and its parts from the structure; projects keep theirs. */
export async function removeStructureElement(db: Scoped, id: number): Promise<void> {
  await run(() => db.q('delete from structure_elements where id = $1', [id]));
}

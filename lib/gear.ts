import type { Scoped } from '@/lib/db';
import type {
  CapabilityDef,
  CapabilityType,
  CapabilityValue,
  GearCategory,
  GearFile,
  GearFileRole,
  GearKind,
  GearModel,
  GearPrivate,
  GearStatus,
  GearUnit,
  Rotation,
} from '@/lib/gearTypes';
import { accountNames, nameOf } from '@/lib/names';
import type { AccessLevel } from '@/lib/studioTypes';

// Server-only gear data layer (REQUIREMENTS §4, db/003). Like lib/studio.ts,
// every function takes a Scoped handle and runs as that person, so row-level
// security decides what each statement sees: the insurance record
// (gear_private) only ever comes back to a unit's owner, and receipts, serial
// plates and documents only to the owner, whatever a unit is shared at.

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const dateOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const UNIQUE_VIOLATION = '23505';
function pgCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code;
}
function pgMessage(err: unknown): string {
  return (err as { message?: string })?.message ?? '';
}

// ── Capability vocabulary ───────────────────────────────────────────────────

export async function listCapabilityDefs(db: Scoped): Promise<CapabilityDef[]> {
  const rows = await db.q(
    'select key, label, value_type, unit, choices, description from capability_defs order by position, label',
  );
  return rows.map((r) => ({
    key: String(r.key),
    label: String(r.label),
    valueType: String(r.value_type) as CapabilityType,
    unit: str(r.unit),
    choices: (r.choices as string[]) ?? [],
    description: str(r.description),
  }));
}

// ── The model catalogue ─────────────────────────────────────────────────────

const MODEL_COLUMNS = `m.id, m.kind, m.category, m.manufacturer, m.model, m.year_introduced, m.year_discontinued, m.description, m.status,
  m.suggested_by, coalesce(m.suggested_by = app_user(), false) as mine`;

async function toModels(db: Scoped, rows: Row[]): Promise<GearModel[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => num(r.id));
  const [caps, who] = await Promise.all([
    db.q('select model_id, capability, value from model_capabilities where model_id = any($1)', [ids]),
    accountNames(db, rows.map((r) => (r.suggested_by ? String(r.suggested_by) : null))),
  ]);
  const byModel = new Map<number, Record<string, CapabilityValue>>();
  for (const c of caps) {
    const id = num(c.model_id);
    const map = byModel.get(id) ?? {};
    map[String(c.capability)] = c.value as CapabilityValue;
    byModel.set(id, map);
  }
  return rows.map((r) => ({
    id: num(r.id),
    kind: String(r.kind) as GearKind,
    category: String(r.category) as GearCategory,
    manufacturer: String(r.manufacturer),
    model: String(r.model),
    yearIntroduced: numOrNull(r.year_introduced),
    yearDiscontinued: numOrNull(r.year_discontinued),
    description: str(r.description),
    status: String(r.status) as GearModel['status'],
    mine: r.mine === true,
    suggestedByName: r.suggested_by ? nameOf(who, String(r.suggested_by)) : 'Bottega',
    capabilities: byModel.get(num(r.id)) ?? {},
  }));
}

/** Approved models (and the viewer's own suggestions) matching a search, for choosing a unit's model. */
export async function searchModels(db: Scoped, query: string, limit = 20): Promise<GearModel[]> {
  const q = query.trim();
  const rows = await db.q(
    `select ${MODEL_COLUMNS} from gear_models m
     where m.status <> 'rejected'
       and ($1 = '' or (m.manufacturer || ' ' || m.model) ilike '%' || $1 || '%')
     order by (m.status = 'approved') desc, m.manufacturer, m.model
     limit $2`,
    [q.replace(/[%_\\]/g, (c) => `\\${c}`), limit],
  );
  return toModels(db, rows);
}

/** Every model, suggestions first, for the administrator's catalogue page. */
export async function listModels(db: Scoped): Promise<GearModel[]> {
  const rows = await db.q(
    `select ${MODEL_COLUMNS} from gear_models m
     order by case m.status when 'suggested' then 0 when 'approved' then 1 else 2 end, m.manufacturer, m.model`,
  );
  return toModels(db, rows);
}

export async function getModel(db: Scoped, id: number): Promise<GearModel | null> {
  const rows = await db.q(`select ${MODEL_COLUMNS} from gear_models m where m.id = $1`, [id]);
  return rows.length ? (await toModels(db, rows))[0] : null;
}

export type SuggestResult = { ok: true; model: GearModel } | { ok: false; reason: 'exists'; existing: GearModel | null };

/**
 * Suggest a model for the catalogue (REQUIREMENTS G-6). From anyone but the
 * administrator it arrives as a suggestion, whatever is sent; the database
 * sees to that.
 */
export async function suggestModel(
  db: Scoped,
  input: {
    kind: GearKind;
    category: GearCategory;
    manufacturer: string;
    model: string;
    yearIntroduced: number | null;
    yearDiscontinued: number | null;
  },
): Promise<SuggestResult> {
  try {
    const rows = await db.q(
      `insert into gear_models (kind, category, manufacturer, model, year_introduced, year_discontinued, status)
       values ($1, $2, $3, $4, $5, $6, 'approved') returning id`,
      [input.kind, input.category, input.manufacturer, input.model, input.yearIntroduced, input.yearDiscontinued],
    );
    const model = await getModel(db, num(rows[0].id));
    if (!model) throw new Error('model vanished after insert');
    return { ok: true, model };
  } catch (err) {
    if (pgCode(err) !== UNIQUE_VIOLATION) throw err;
    const existing = await db.q(
      `select ${MODEL_COLUMNS} from gear_models m where lower(m.manufacturer) = lower($1) and lower(m.model) = lower($2)`,
      [input.manufacturer, input.model],
    );
    return { ok: false, reason: 'exists', existing: existing.length ? (await toModels(db, existing))[0] : null };
  }
}

export type ModelField =
  | 'kind' | 'category' | 'manufacturer' | 'model' | 'yearIntroduced' | 'yearDiscontinued' | 'description' | 'status';

/** The administrator's changes to a model: its facts and its status. */
export async function updateModel(
  db: Scoped,
  id: number,
  patch: Partial<Pick<GearModel, ModelField>>,
): Promise<GearModel | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of [
    ['kind', 'kind'],
    ['category', 'category'],
    ['manufacturer', 'manufacturer'],
    ['model', 'model'],
    ['yearIntroduced', 'year_introduced'],
    ['yearDiscontinued', 'year_discontinued'],
    ['description', 'description'],
    ['status', 'status'],
  ] as const) {
    if (patch[field] !== undefined) set.push(`${column} = $${params.push(patch[field])}`);
  }
  if (set.length) await db.q(`update gear_models set ${set.join(', ')} where id = $${params.push(id)}`, params);
  return getModel(db, id);
}

export async function setModelCapability(db: Scoped, modelId: number, key: string, value: CapabilityValue | null): Promise<void> {
  if (value === null) {
    await db.q('delete from model_capabilities where model_id = $1 and capability = $2', [modelId, key]);
  } else {
    await db.q(
      `insert into model_capabilities (model_id, capability, value) values ($1, $2, $3::jsonb)
       on conflict (model_id, capability) do update set value = excluded.value`,
      [modelId, key, JSON.stringify(value)],
    );
  }
}

// ── Units ───────────────────────────────────────────────────────────────────

const UNIT_SELECT = `
  select g.id, g.owner_id, gear_level(g.id) as level, g.manufacturer, g.name, g.nickname, g.status, g.firmware,
         g.notes, g.created_at, m.id as model_id, m.kind as model_kind, m.category as model_category,
         m.manufacturer as model_manufacturer, m.model as model_model, m.status as model_status,
         p.id as photo_id, p.rotation as photo_rotation
  from gear g
  left join gear_models m on m.id = g.model_id
  -- The list's picture: the first photo the viewer may see (row-level
  -- security decides which), public ones first.
  left join lateral (
    select f.id, f.rotation from gear_files f
    where f.gear_id = g.id and f.role = 'photo'
    order by f.public desc, f.uploaded_at limit 1
  ) p on true`;

// Repeats row-level security in SQL, as lib/studio.ts does for projects.
const UNIT_VISIBLE = 'gear_level(g.id) is not null';

async function toUnits(db: Scoped, rows: Row[]): Promise<GearUnit[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => num(r.id));
  const [caps, owners] = await Promise.all([
    db.q('select gear_id, capability, value, overridden from gear_capabilities_effective where gear_id = any($1)', [ids]),
    accountNames(db, rows.map((r) => String(r.owner_id))),
  ]);
  const byUnit = new Map<number, GearUnit['capabilities']>();
  for (const c of caps) {
    const id = num(c.gear_id);
    const map = byUnit.get(id) ?? {};
    map[String(c.capability)] = { value: c.value as CapabilityValue, overridden: c.overridden === true };
    byUnit.set(id, map);
  }
  return rows.map((r) => ({
    id: num(r.id),
    ownerId: String(r.owner_id),
    ownerName: nameOf(owners, String(r.owner_id)),
    level: (r.level ?? 'view') as AccessLevel,
    model:
      r.model_id === null || r.model_id === undefined
        ? null
        : {
            id: num(r.model_id),
            kind: String(r.model_kind) as GearKind,
            category: String(r.model_category) as GearCategory,
            manufacturer: String(r.model_manufacturer),
            model: String(r.model_model),
            status: String(r.model_status) as GearModel['status'],
          },
    manufacturer: str(r.manufacturer),
    name: str(r.name),
    nickname: str(r.nickname),
    status: String(r.status) as GearStatus,
    firmware: str(r.firmware),
    notes: str(r.notes),
    createdAt: iso(r.created_at),
    capabilities: byUnit.get(num(r.id)) ?? {},
    photoId: numOrNull(r.photo_id),
    photoRotation: (numOrNull(r.photo_rotation) ?? 0) as Rotation,
  }));
}

/** Every unit the viewer can see: their own and those shared with them. */
export async function listGear(db: Scoped): Promise<GearUnit[]> {
  const rows = await db.q(
    `${UNIT_SELECT} where ${UNIT_VISIBLE}
     order by coalesce(m.manufacturer, g.manufacturer), coalesce(m.model, g.name), g.nickname`,
  );
  return toUnits(db, rows);
}

export async function getGear(db: Scoped, id: number): Promise<GearUnit | null> {
  const rows = await db.q(`${UNIT_SELECT} where g.id = $1 and ${UNIT_VISIBLE}`, [id]);
  return rows.length ? (await toUnits(db, rows))[0] : null;
}

export async function createGear(
  db: Scoped,
  input: { modelId: number | null; manufacturer: string; name: string; nickname: string; status: GearStatus },
): Promise<GearUnit> {
  const rows = await db.q(
    'insert into gear (model_id, manufacturer, name, nickname, status) values ($1, $2, $3, $4, $5) returning id',
    [input.modelId, input.modelId ? '' : input.manufacturer, input.modelId ? '' : input.name, input.nickname, input.status],
  );
  const unit = await getGear(db, num(rows[0].id));
  if (!unit) throw new Error('gear vanished after insert');
  return unit;
}

export type GearPatch = Partial<Pick<GearUnit, 'nickname' | 'status' | 'firmware' | 'notes' | 'manufacturer' | 'name'>> & {
  modelId?: number | null;
};

export async function updateGear(db: Scoped, id: number, patch: GearPatch): Promise<GearUnit | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of [
    ['nickname', 'nickname'],
    ['status', 'status'],
    ['firmware', 'firmware'],
    ['notes', 'notes'],
    ['manufacturer', 'manufacturer'],
    ['name', 'name'],
    ['modelId', 'model_id'],
  ] as const) {
    if (patch[field] !== undefined) set.push(`${column} = $${params.push(patch[field])}`);
  }
  if (set.length) await db.q(`update gear set ${set.join(', ')} where id = $${params.push(id)}`, params);
  return getGear(db, id);
}

/** Deletes the unit and returns the storage keys of its files, for the route to remove from R2. */
export async function deleteGear(db: Scoped, id: number): Promise<string[]> {
  const files = await db.q('select r2_key from gear_files where gear_id = $1', [id]);
  await db.q('delete from gear where id = $1', [id]);
  return files.map((f) => String(f.r2_key));
}

export async function setGearCapability(db: Scoped, gearId: number, key: string, value: CapabilityValue | null): Promise<void> {
  if (value === null) {
    await db.q('delete from gear_capabilities where gear_id = $1 and capability = $2', [gearId, key]);
  } else {
    await db.q(
      `insert into gear_capabilities (gear_id, capability, value) values ($1, $2, $3::jsonb)
       on conflict (gear_id, capability) do update set value = excluded.value`,
      [gearId, key, JSON.stringify(value)],
    );
  }
}

export function isCapabilityRefusal(err: unknown): boolean {
  return /is not a valid value/.test(pgMessage(err));
}

// ── The insurance record (owner only) ───────────────────────────────────────

const PRIVATE_COLUMNS = `serial, purchase_date, purchase_price, currency, purchased_from, condition, location,
  service_history, license_key, license_seats, license_activation, license_renewal, estimated_value, valued_on`;

/** The owner's record, or null for anyone else (the database returns no row). */
export async function getGearPrivate(db: Scoped, gearId: number): Promise<GearPrivate | null> {
  const rows = await db.q(`select ${PRIVATE_COLUMNS} from gear_private where gear_id = $1`, [gearId]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    serial: str(r.serial),
    purchaseDate: dateOrNull(r.purchase_date),
    purchasePrice: numOrNull(r.purchase_price),
    currency: str(r.currency) || 'USD',
    purchasedFrom: str(r.purchased_from),
    condition: str(r.condition),
    location: str(r.location),
    serviceHistory: str(r.service_history),
    licenseKey: str(r.license_key),
    licenseSeats: numOrNull(r.license_seats),
    licenseActivation: str(r.license_activation),
    licenseRenewal: dateOrNull(r.license_renewal),
    estimatedValue: numOrNull(r.estimated_value),
    valuedOn: dateOrNull(r.valued_on),
  };
}

const PRIVATE_FIELDS: [keyof GearPrivate, string][] = [
  ['serial', 'serial'],
  ['purchaseDate', 'purchase_date'],
  ['purchasePrice', 'purchase_price'],
  ['currency', 'currency'],
  ['purchasedFrom', 'purchased_from'],
  ['condition', 'condition'],
  ['location', 'location'],
  ['serviceHistory', 'service_history'],
  ['licenseKey', 'license_key'],
  ['licenseSeats', 'license_seats'],
  ['licenseActivation', 'license_activation'],
  ['licenseRenewal', 'license_renewal'],
  ['estimatedValue', 'estimated_value'],
  ['valuedOn', 'valued_on'],
];

export async function updateGearPrivate(db: Scoped, gearId: number, patch: Partial<GearPrivate>): Promise<GearPrivate | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of PRIVATE_FIELDS) {
    if (patch[field] !== undefined) set.push(`${column} = $${params.push(patch[field])}`);
  }
  if (set.length) await db.q(`update gear_private set ${set.join(', ')} where gear_id = $${params.push(gearId)}`, params);
  return getGearPrivate(db, gearId);
}

// ── Files ───────────────────────────────────────────────────────────────────

const FILE_COLUMNS = 'id, gear_id, role, filename, content_type, bytes, caption, public, rotation, uploaded_by_id, uploaded_at';

async function toFiles(db: Scoped, rows: Row[]): Promise<GearFile[]> {
  const who = await accountNames(db, rows.map((r) => (r.uploaded_by_id ? String(r.uploaded_by_id) : null)));
  return rows.map((r) => ({
    id: num(r.id),
    gearId: num(r.gear_id),
    role: String(r.role) as GearFileRole,
    filename: String(r.filename),
    contentType: str(r.content_type),
    bytes: numOrNull(r.bytes),
    caption: str(r.caption),
    isPublic: r.public === true,
    rotation: num(r.rotation) as Rotation,
    uploadedByName: nameOf(who, r.uploaded_by_id ? String(r.uploaded_by_id) : null),
    uploadedAt: iso(r.uploaded_at),
  }));
}

/** The files the viewer may see: public ones on any unit they can see, every file on their own (db/006). */
export async function listGearFiles(db: Scoped, gearId: number): Promise<GearFile[]> {
  const rows = await db.q(`select ${FILE_COLUMNS} from gear_files where gear_id = $1 order by role, uploaded_at`, [gearId]);
  return toFiles(db, rows);
}

export async function getGearFileWithKey(db: Scoped, id: number): Promise<{ file: GearFile; key: string } | null> {
  const rows = await db.q(`select ${FILE_COLUMNS}, r2_key from gear_files where id = $1`, [id]);
  if (!rows.length) return null;
  return { file: (await toFiles(db, rows))[0], key: String(rows[0].r2_key) };
}

export async function addGearFile(
  db: Scoped,
  input: {
    gearId: number;
    role: GearFileRole;
    key: string;
    filename: string;
    contentType: string;
    bytes: number;
    isPublic: boolean;
  },
): Promise<GearFile> {
  const rows = await db.q(
    `insert into gear_files (gear_id, role, r2_key, filename, content_type, bytes, public)
     values ($1, $2, $3, $4, $5, $6, $7) returning ${FILE_COLUMNS}`,
    [input.gearId, input.role, input.key, input.filename, input.contentType, input.bytes, input.isPublic],
  );
  return (await toFiles(db, rows))[0];
}

export type GearFilePatch = { caption?: string; role?: GearFileRole; isPublic?: boolean; rotation?: Rotation };

export async function updateGearFile(db: Scoped, id: number, patch: GearFilePatch): Promise<GearFile | null> {
  const set: string[] = [];
  const params: unknown[] = [];
  if (patch.caption !== undefined) set.push(`caption = $${params.push(patch.caption)}`);
  if (patch.role !== undefined) set.push(`role = $${params.push(patch.role)}`);
  if (patch.isPublic !== undefined) set.push(`public = $${params.push(patch.isPublic)}`);
  if (patch.rotation !== undefined) set.push(`rotation = $${params.push(patch.rotation)}`);
  if (set.length) await db.q(`update gear_files set ${set.join(', ')} where id = $${params.push(id)}`, params);
  return (await getGearFileWithKey(db, id))?.file ?? null;
}

export async function deleteGearFileRow(db: Scoped, id: number): Promise<void> {
  await db.q('delete from gear_files where id = $1', [id]);
}

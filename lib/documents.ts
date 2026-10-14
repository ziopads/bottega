import type { Scoped } from '@/lib/db';
import type {
  Allowance,
  DocumentKind,
  DocumentState,
  FingerprintMatch,
  LinkedModel,
  ReviewStatus,
  StudioDocument,
} from '@/lib/documentTypes';
import type { Chunk } from '@/lib/chunk';
import { CHUNKER_VERSION } from '@/lib/chunk';
import { vectorLiteral } from '@/lib/embed';
import { accountNames, nameOf } from '@/lib/names';
import type { AccessLevel } from '@/lib/studioTypes';

// Server-only documents data layer (REQUIREMENTS §8, db/004). Every function
// takes a Scoped handle and runs as that person: row-level security decides
// which documents, pages and chunks each statement sees or may change, and
// claim_pages() is the only way to spend the processing allowance.

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

const UNIQUE_VIOLATION = '23505';
function pgCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code;
}

const DOC_SELECT = `
  select d.id, d.library, d.owner_id, d.contributed_by, d.review_status, d.kind, d.title, d.manufacturer, d.model,
         d.filename, d.bytes, d.page_count, d.pages_done, d.state, d.state_detail, d.created_at,
         document_level(d.id) as level,
         (select count(*) from pages p where p.document_id = d.id) as pages_extracted,
         exists (select 1 from library_picks lp where lp.document_id = d.id and lp.user_id = app_user()) as picked,
         coalesce((select json_agg(json_build_object('id', m.id, 'manufacturer', m.manufacturer, 'model', m.model, 'kind', m.kind, 'category', m.category) order by m.manufacturer, m.model)
                   from model_documents md join gear_models m on m.id = md.model_id
                   where md.document_id = d.id), '[]'::json) as models
  from documents d`;

async function toDocuments(db: Scoped, rows: Row[]): Promise<StudioDocument[]> {
  const names = await accountNames(
    db,
    rows.flatMap((r) => [strOrNull(r.owner_id), strOrNull(r.contributed_by)]),
  );
  return rows.map((r) => ({
    id: num(r.id),
    library: r.library === true,
    ownerId: strOrNull(r.owner_id),
    ownerName: r.owner_id ? nameOf(names, String(r.owner_id)) : '',
    contributedBy: strOrNull(r.contributed_by),
    contributorName: r.contributed_by ? nameOf(names, String(r.contributed_by)) : '',
    reviewStatus: str(r.review_status) as ReviewStatus,
    kind: str(r.kind) as DocumentKind,
    title: str(r.title),
    manufacturer: str(r.manufacturer),
    model: str(r.model),
    filename: str(r.filename),
    bytes: num(r.bytes),
    pageCount: numOrNull(r.page_count),
    pagesExtracted: num(r.pages_extracted),
    pagesDone: num(r.pages_done),
    state: str(r.state) as DocumentState,
    stateDetail: str(r.state_detail),
    createdAt: iso(r.created_at),
    level: (strOrNull(r.level) as AccessLevel | null) ?? null,
    picked: r.picked === true,
    models: (r.models as LinkedModel[]) ?? [],
  }));
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** Every document the person can see: their own, those shared with them, the approved library, their submissions. */
export async function listDocuments(db: Scoped): Promise<StudioDocument[]> {
  const rows = await db.q(`${DOC_SELECT} order by d.library, lower(d.manufacturer), lower(d.model), lower(d.title)`);
  return toDocuments(db, rows);
}

export async function getDocument(db: Scoped, id: number): Promise<StudioDocument | null> {
  const rows = await db.q(`${DOC_SELECT} where d.id = $1`, [id]);
  return rows.length ? (await toDocuments(db, rows))[0] : null;
}

/** The storage key and fingerprint, for the routes that touch the file. */
export async function getDocumentFile(
  db: Scoped,
  id: number,
): Promise<{ key: string; sha256: string; filename: string } | null> {
  const rows = await db.q('select r2_key, sha256, filename from documents where id = $1', [id]);
  if (!rows.length) return null;
  return { key: str(rows[0].r2_key), sha256: str(rows[0].sha256), filename: str(rows[0].filename) };
}

/** Library documents linked to a catalogue model (REQUIREMENTS G-4). */
export async function listModelDocuments(db: Scoped, modelId: number): Promise<StudioDocument[]> {
  const rows = await db.q(
    `${DOC_SELECT} where d.id in (select document_id from model_documents where model_id = $1)
     order by lower(d.title)`,
    [modelId],
  );
  return toDocuments(db, rows);
}

/** Does Bottega already hold this file? By fingerprint, before anything is uploaded (K-8). */
export async function fingerprintMatch(db: Scoped, sha256: string): Promise<FingerprintMatch> {
  const sha = sha256.toLowerCase();
  const [lib, own] = await db.tx([
    {
      text: `select f.id, f.review_status, exists (select 1 from documents d where d.id = f.id) as visible
             from find_library_document($1) f`,
      params: [sha],
    },
    { text: 'select id, title from documents where not library and owner_id = app_user() and sha256 = $1', params: [sha] },
  ]);
  return {
    library: lib.length
      ? { id: num(lib[0].id), reviewStatus: str(lib[0].review_status) as ReviewStatus, visible: lib[0].visible === true }
      : null,
    own: own.length ? { id: num(own[0].id), title: str(own[0].title) } : null,
  };
}

export async function getAllowance(db: Scoped): Promise<Allowance | null> {
  const rows = await db.q('select * from my_allowance()');
  if (!rows.length) return null;
  const r = rows[0];
  return {
    storageBytes: numOrNull(r.storage_bytes),
    storageUsed: num(r.storage_used),
    pagesPerMonth: numOrNull(r.pages_per_month),
    pagesUsed: num(r.pages_used),
    maxDocumentPages: numOrNull(r.max_document_pages),
    platformPagesLeft: num(r.platform_pages_left),
  };
}

/** Room for bytes more under the person's storage allowance. */
export function storageAllows(a: Allowance, bytes: number): boolean {
  return a.storageBytes === null || a.storageUsed + bytes <= a.storageBytes;
}

// ── Writing ─────────────────────────────────────────────────────────────────

export type CreateResult = { ok: true; id: number } | { ok: false; reason: 'exists' };

/** Record an upload that has reached storage. The database sets the owner, contributor and review status. */
export async function createDocument(
  db: Scoped,
  input: {
    library: boolean;
    kind: DocumentKind;
    title: string;
    manufacturer: string;
    model: string;
    key: string;
    filename: string;
    bytes: number;
    sha256: string;
  },
): Promise<CreateResult> {
  try {
    const rows = await db.q(
      // owner_id, contributed_by and review_status are set by documents_guard.
      `insert into documents (library, kind, title, manufacturer, model, r2_key, filename, bytes, sha256)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [input.library, input.kind, input.title, input.manufacturer, input.model, input.key, input.filename, input.bytes, input.sha256.toLowerCase()],
    );
    return { ok: true, id: num(rows[0].id) };
  } catch (err) {
    if (pgCode(err) === UNIQUE_VIOLATION) return { ok: false, reason: 'exists' };
    throw err;
  }
}

export type DocumentPatch = Partial<{ title: string; manufacturer: string; model: string; kind: DocumentKind }>;

export async function updateDocument(db: Scoped, id: number, patch: DocumentPatch): Promise<boolean> {
  const rows = await db.q(
    `update documents set
       title = coalesce($2, title), manufacturer = coalesce($3, manufacturer), model = coalesce($4, model), kind = coalesce($5, kind)
     where id = $1 returning id`,
    [id, patch.title ?? null, patch.manufacturer ?? null, patch.model ?? null, patch.kind ?? null],
  );
  return rows.length > 0;
}

/**
 * The platform administrator moves a document between the library and
 * private documents (db/018 document_set_home): returns null when done, or the
 * refusal to show.
 */
export async function setDocumentHome(db: Scoped, id: number, library: boolean, kind: DocumentKind): Promise<string | null> {
  try {
    await db.q('select document_set_home($1, $2, $3)', [id, library, kind]);
    return null;
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? '';
    if (/administrator|already|library takes|no kind|no document/.test(msg)) return msg.charAt(0).toUpperCase() + msg.slice(1) + '.';
    throw err;
  }
}

/** The platform administrator's review of a library submission (K-6). */
export async function reviewDocument(db: Scoped, id: number, status: ReviewStatus): Promise<boolean> {
  const rows = await db.q('update documents set review_status = $2 where id = $1 and library returning id', [id, status]);
  return rows.length > 0;
}

/** Deletes the row (pages, chunks and links go with it) and returns the storage key to delete, or null if refused. */
export async function deleteDocument(db: Scoped, id: number): Promise<string | null> {
  const rows = await db.q('delete from documents where id = $1 returning r2_key', [id]);
  return rows.length ? str(rows[0].r2_key) : null;
}

export async function setPicked(db: Scoped, id: number, picked: boolean): Promise<void> {
  if (picked) {
    await db.q('insert into library_picks (document_id) values ($1) on conflict do nothing', [id]);
  } else {
    await db.q('delete from library_picks where document_id = $1 and user_id = app_user()', [id]);
  }
}

export async function linkModel(db: Scoped, documentId: number, modelId: number): Promise<boolean> {
  try {
    await db.q('insert into model_documents (model_id, document_id) values ($1, $2) on conflict do nothing', [modelId, documentId]);
    return true;
  } catch (err) {
    if (pgCode(err) === '42501') return false; // refused by the policy
    throw err;
  }
}

export async function unlinkModel(db: Scoped, documentId: number, modelId: number): Promise<boolean> {
  const rows = await db.q('delete from model_documents where model_id = $1 and document_id = $2 returning model_id', [
    modelId,
    documentId,
  ]);
  return rows.length > 0;
}

// ── Processing (REQUIREMENTS K-9, K-10) ─────────────────────────────────────

export async function setProcessingState(
  db: Scoped,
  id: number,
  fields: { state: DocumentState; detail?: string; pageCount?: number },
): Promise<void> {
  await db.q(
    `update documents set state = $2, state_detail = $3, page_count = coalesce($4, page_count) where id = $1`,
    [id, fields.state, fields.detail ?? '', fields.pageCount ?? null],
  );
}

/** Store extracted page text. Pages already stored are left as they are. */
export async function storePages(db: Scoped, id: number, pages: { page: number; text: string }[]): Promise<void> {
  if (!pages.length) return;
  await db.q(
    `insert into pages (document_id, page_number, text)
     select $1, n, t from unnest($2::int[], $3::text[]) as x(n, t)
     on conflict do nothing`,
    [id, pages.map((p) => p.page), pages.map((p) => p.text)],
  );
}

export async function readPages(db: Scoped, id: number, from: number, to: number): Promise<{ page: number; text: string }[]> {
  const rows = await db.q(
    'select page_number, text from pages where document_id = $1 and page_number between $2 and $3 order by page_number',
    [id, from, to],
  );
  return rows.map((r) => ({ page: num(r.page_number), text: str(r.text) }));
}

/** Thin pages are judged over the whole document once extraction ends. */
export async function allPageTexts(db: Scoped, id: number): Promise<string[]> {
  const rows = await db.q('select text from pages where document_id = $1 order by page_number', [id]);
  return rows.map((r) => str(r.text));
}

/** Spend up to n pages of the allowance on this document. Returns the ledger row and the pages granted (perhaps 0). */
export async function claimPages(db: Scoped, id: number, n: number): Promise<{ usageId: number; granted: number }> {
  const rows = await db.q('select usage_id, granted from claim_pages($1, $2)', [id, n]);
  return { usageId: num(rows[0].usage_id), granted: num(rows[0].granted) };
}

export async function recordTokens(db: Scoped, usageId: number, tokens: number): Promise<void> {
  await db.q('select record_tokens($1, $2)', [usageId, tokens]);
}

/**
 * Store one batch's chunks and advance pages_done, in one transaction, only
 * if pages_done is still what this batch started from. Chunks a failed
 * earlier attempt left past that point are removed first. Returns false when
 * another request got there first (two tabs processing the same document).
 */
export async function commitBatch(
  db: Scoped,
  id: number,
  fromDone: number,
  toDone: number,
  chunks: (Chunk & { vector: number[] })[],
  finalState: DocumentState,
): Promise<boolean> {
  const unchanged = 'exists (select 1 from documents where id = $1 and pages_done = $2)';
  const results = await db.tx([
    { text: `delete from chunks where document_id = $1 and first_page > $2 and ${unchanged}`, params: [id, fromDone] },
    {
      text: `insert into chunks (document_id, first_page, last_page, text, embedding, chunker_version)
             select $1, f, l, t, e::halfvec(1024), $7
             from unnest($3::int[], $4::int[], $5::text[], $6::text[]) as x(f, l, t, e)
             where ${unchanged}`,
      params: [
        id,
        fromDone,
        chunks.map((c) => c.firstPage),
        chunks.map((c) => c.lastPage),
        chunks.map((c) => c.text),
        chunks.map((c) => vectorLiteral(c.vector)),
        CHUNKER_VERSION,
      ],
    },
    {
      text: `update documents set pages_done = $3, state = $4, state_detail = '' where id = $1 and pages_done = $2 returning id`,
      params: [id, fromDone, toDone, finalState],
    },
  ]);
  return results[2].length > 0;
}

// ── Printed page numbers and contents (db/022) ───────────────────────────────

/** Replaces the PDF's own labels and outline for a document; hand-set labels stay. */
export async function storeStructure(
  db: Scoped,
  id: number,
  structure: { labels: (string | null)[]; outline: { level: number; title: string; page: number }[] },
): Promise<void> {
  const pages: number[] = [];
  const labels: string[] = [];
  structure.labels.forEach((l, i) => {
    if (l) {
      pages.push(i + 1);
      labels.push(l);
    }
  });
  await db.tx([
    // The PDF's labels are replaced; hand-set ones stay.
    { text: 'delete from document_page_labels where document_id = $1 and hand_label is null', params: [id] },
    { text: 'update document_page_labels set pdf_label = null where document_id = $1 and pdf_label is not null', params: [id] },
    {
      text: `insert into document_page_labels (document_id, page, pdf_label)
             select $1, p, l from unnest($2::int[], $3::text[]) as x(p, l)
             on conflict (document_id, page) do update set pdf_label = excluded.pdf_label`,
      params: [id, pages, labels],
    },
    { text: 'delete from document_sections where document_id = $1', params: [id] },
    {
      text: `insert into document_sections (document_id, position, level, title, page)
             select $1, ord, lv, t, p from unnest($2::int[], $3::text[], $4::int[]) with ordinality as x(lv, t, p, ord)`,
      params: [id, structure.outline.map((o) => o.level), structure.outline.map((o) => o.title), structure.outline.map((o) => o.page)],
    },
  ]);
}

export interface DocumentSection {
  level: number;
  title: string;
  page: number;
}

export async function getSections(db: Scoped, id: number): Promise<DocumentSection[]> {
  const rows = await db.q('select level, title, page from document_sections where document_id = $1 order by position', [id]);
  return rows.map((r) => ({ level: num(r.level), title: str(r.title), page: num(r.page) }));
}

/** Printed labels for some pages of some documents: "docId:page" → label. */
export async function pageLabels(db: Scoped, pairs: { documentId: number; page: number }[]): Promise<Map<string, string>> {
  if (!pairs.length) return new Map();
  const rows = await db.q(
    `select l.document_id, l.page, coalesce(l.hand_label, l.pdf_label) as label
       from document_page_labels l
      where (l.document_id, l.page) in (select * from unnest($1::bigint[], $2::int[]))`,
    [pairs.map((p) => p.documentId), pairs.map((p) => p.page)],
  );
  return new Map(rows.map((r) => [`${num(r.document_id)}:${num(r.page)}`, str(r.label)]));
}

/** The printed label of each page in from..to, and the section each page falls in. */
export async function pageContext(
  db: Scoped,
  id: number,
  from: number,
  to: number,
): Promise<Map<number, { label: string | null; section: string | null }>> {
  const rows = await db.q(
    `select p as page,
            (select coalesce(hand_label, pdf_label) from document_page_labels l where l.document_id = $1 and l.page = p) as label,
            (select title from document_sections s where s.document_id = $1 and s.page <= p order by s.page desc, s.position desc limit 1) as section
       from generate_series($2::int, $3::int) as p`,
    [id, from, to],
  );
  return new Map(rows.map((r) => [num(r.page), { label: strOrNull(r.label), section: strOrNull(r.section) }]));
}

/** Sets printed numbers by hand for pages from..to (style 'none' clears them). Returns a refusal to show, or null. */
export async function setLabelRange(
  db: Scoped,
  id: number,
  range: { from: number; to: number; first: number | null; style: 'arabic' | 'roman' | 'none' },
): Promise<string | null> {
  try {
    await db.q('select document_label_range($1, $2, $3, $4, $5)', [id, range.from, range.to, range.first, range.style]);
    return null;
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? '';
    if (/needs edit access|give a range|arabic or roman/.test(msg)) return msg.charAt(0).toUpperCase() + msg.slice(1) + '.';
    throw err;
  }
}

/** How many pages carry a printed label, and how many sections the contents has. */
export async function structureSummary(db: Scoped, id: number): Promise<{ labelled: number; hand: number; sections: number }> {
  const rows = await db.q(
    `select (select count(*) from document_page_labels where document_id = $1) as labelled,
            (select count(*) from document_page_labels where document_id = $1 and hand_label is not null) as hand,
            (select count(*) from document_sections where document_id = $1) as sections`,
    [id],
  );
  return { labelled: num(rows[0].labelled), hand: num(rows[0].hand), sections: num(rows[0].sections) };
}

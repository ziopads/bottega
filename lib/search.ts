import type { Scoped } from '@/lib/db';
import { EmbedError, embedConfigured, embedQuery, vectorLiteral } from '@/lib/embed';

// Corpus search (REQUIREMENTS K-2, K-3, K-7; ARCHITECTURE §3): keyword and
// meaning, each ranked on its own, combined by reciprocal rank fusion in one
// statement. Server only; used by the connector's search tool and, later, a
// search box in the app.
//
// Scope. 'mine' (the default, K-7) is the person's private documents and
// those shared with them, the library manuals they picked, and the library
// manuals linked to the models of the gear they own. 'all' adds the rest of
// the library. Either can be narrowed to given documents.
//
// Row-level security decides which chunks a person may read, but it filters
// after the nearest-neighbour index has chosen its candidates: with most
// close matches in documents the person cannot see, a search would come back
// short. So the query first lists the documents in scope, searches only their
// chunks, and lets pgvector keep scanning (iterative scan) until it has
// enough (pgvector 0.8; with an older one the search still runs, without it).
//
// Pages are numbered by their place in the PDF, from 1, which may differ from
// the numbers printed on them.

export type SearchScope = 'mine' | 'all';

export type SearchHit = {
  documentId: number;
  title: string;
  kind: string;
  manufacturer: string;
  model: string;
  firstPage: number;
  lastPage: number;
  text: string;
  /** Found by the words, by the meaning, or both. */
  by: ('words' | 'meaning')[];
  score: number;
};

export type SearchResult = {
  hits: SearchHit[];
  /** Documents searched, with how far each is searchable. */
  documents: { id: number; title: string; searchable: boolean }[];
  /** False when the meaning half could not run (no embedding service): words only. */
  meaning: boolean;
};

/** Candidates each half contributes before fusion, and the fusion constant. */
const CANDIDATES = 40;
const RRF_K = 60;

const SCOPE_SQL = `
  select d.id, d.title, d.pages_done > 0 as searchable
    from documents d
   where document_rank(d.id) > 0
     and (d.review_status = 'approved' or not d.library)
     and (cardinality($2::bigint[]) = 0 or d.id = any($2::bigint[]))
     and ($1 = 'all'
          or not d.library
          or exists (select 1 from library_picks p where p.document_id = d.id and p.user_id = app_user())
          or exists (select 1 from model_documents md join gear g on g.model_id = md.model_id
                      where md.document_id = d.id and g.owner_id = app_user() and g.status = 'owned'))`;

export async function searchCorpus(
  db: Scoped,
  input: { query: string; scope?: SearchScope; documentIds?: number[]; limit?: number },
): Promise<SearchResult> {
  const query = input.query.trim();
  const scope = input.scope ?? 'mine';
  const ids = (input.documentIds ?? []).filter((n) => Number.isInteger(n) && n > 0);
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);

  let vector: string | null = null;
  if (embedConfigured()) {
    try {
      vector = vectorLiteral(await embedQuery(query));
    } catch (err) {
      if (!(err instanceof EmbedError)) throw err;
    }
  }

  const [, , docs, rows] = await db.tx([
    // Iterative scan needs pgvector 0.8. Using the type loads the extension, so
    // its settings exist by the second statement; an older pgvector simply
    // has no such setting, and nothing is set.
    { text: `select '[0]'::halfvec is not null as loaded` },
    { text: `select set_config(name, 'relaxed_order', true) from pg_settings where name = 'hnsw.iterative_scan'` },
    { text: SCOPE_SQL, params: [scope, ids] },
    {
      text: `
      with scope as (${SCOPE_SQL}),
      q as (select websearch_to_tsquery('english', $3) as ts),
      words as (
        select c.id, row_number() over (order by ts_rank_cd(c.tsv, q.ts) desc, c.id) as r
          from chunks c, q
         where c.document_id in (select id from scope) and c.tsv @@ q.ts
         order by ts_rank_cd(c.tsv, q.ts) desc, c.id
         limit ${CANDIDATES}),
      meaning as (
        select c.id, row_number() over (order by c.embedding <=> $4::halfvec, c.id) as r
          from chunks c
         where $4::text is not null and c.embedding is not null and c.document_id in (select id from scope)
         order by c.embedding <=> $4::halfvec, c.id
         limit ${CANDIDATES}),
      fused as (
        select id, sum(1.0 / (${RRF_K} + r)) as score,
               bool_or(src = 'words') as by_words, bool_or(src = 'meaning') as by_meaning
          from (select id, r, 'words' as src from words union all select id, r, 'meaning' from meaning) x
         group by id
         order by score desc
         limit $5)
      select c.document_id, d.title, d.kind, d.manufacturer, d.model, c.first_page, c.last_page, c.text,
             f.score, f.by_words, f.by_meaning
        from fused f join chunks c on c.id = f.id join documents d on d.id = c.document_id
       order by f.score desc`,
      params: [scope, ids, query, vector, limit],
    },
  ]);

  return {
    hits: rows.map((r) => ({
      documentId: Number(r.document_id),
      title: String(r.title),
      kind: String(r.kind),
      manufacturer: String(r.manufacturer ?? ''),
      model: String(r.model ?? ''),
      firstPage: Number(r.first_page),
      lastPage: Number(r.last_page),
      text: String(r.text),
      by: [...(r.by_words ? (['words'] as const) : []), ...(r.by_meaning ? (['meaning'] as const) : [])],
      score: Number(r.score),
    })),
    documents: docs.map((r) => ({ id: Number(r.id), title: String(r.title), searchable: r.searchable === true })),
    meaning: vector !== null,
  };
}

/** Pages of one document, at most MAX_PAGES at a time, with the document's page count. */
export const MAX_PAGES = 10;

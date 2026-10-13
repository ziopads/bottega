// The corpus on the connector (REQUIREMENTS K-2, K-3, K-7, M-2): the
// documents a person can search, search over them, and their pages in full.
// Every page cited comes with a link to the page reader in the app, so the
// person can check it.

import type { Scoped } from '@/lib/db';
import { getDocument, listDocuments, pageContext, pageLabels, readPages } from '@/lib/documents';
import { DOCUMENT_KIND_LABEL } from '@/lib/documentTypes';
import { MAX_PAGES, searchCorpus, type SearchScope } from '@/lib/search';
import { ToolError } from '@/mcp/context';

const readerUrl = (origin: string, id: number, page: number, q?: string) =>
  `${origin}/library/${id}/read?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

export async function listDocumentsTool(db: Scoped, origin: string) {
  const docs = await listDocuments(db);
  const me = db.person.userId;
  return {
    note: 'Pages are numbered by their place in the PDF, from 1; printed page numbers may differ.',
    documents: docs
      .filter((d) => !d.library || d.reviewStatus === 'approved' || d.contributedBy === me)
      .map((d) => ({
        id: d.id,
        title: d.title,
        kind: DOCUMENT_KIND_LABEL[d.kind],
        about: [d.manufacturer, d.model].filter(Boolean).join(' ') || null,
        where: d.library ? 'library' : d.ownerId === me ? 'yours, private' : `shared with you by ${d.ownerName}`,
        pages: d.pageCount,
        searchable: d.pagesDone > 0 ? (d.pagesDone >= (d.pageCount ?? 0) ? 'yes' : `pages 1–${d.pagesDone} so far`) : 'not yet',
        state: d.state,
        link: `${origin}/library/${d.id}`,
      })),
  };
}

export async function searchTool(
  db: Scoped,
  origin: string,
  args: { query: string; scope?: SearchScope; documents?: number[]; limit?: number; group?: number },
) {
  const query = args.query.trim();
  if (!query) throw new ToolError('Give a query.');
  if (query.length > 500) throw new ToolError('Keep the query under 500 characters.');
  if (args.group !== undefined) {
    const rows = await db.q('select study_member($1) as member, (select count(*) from study_group_documents where group_id = $1) as listed', [args.group]);
    if (rows[0]?.member !== true) throw new ToolError(`No study group ${args.group} that you belong to. get_study_group lists yours.`);
    if (Number(rows[0].listed) === 0) {
      throw new ToolError('This group’s reading list is empty. Ask the custodian to add documents on its Resources tab, or search without group.');
    }
  }
  const r = await searchCorpus(db, { query, scope: args.scope, documentIds: args.documents, limit: args.limit, groupId: args.group ?? null });
  const printed = await pageLabels(db, r.hits.map((h) => ({ documentId: h.documentId, page: h.firstPage })));
  return {
    query,
    scope: args.group !== undefined ? `study group ${args.group}'s reading list` : (args.scope ?? 'mine'),
    matched_by: r.meaning ? 'words and meaning' : 'words only (the embedding service did not answer)',
    documents_searched: r.documents.map((d) => (d.searchable ? `${d.id} ${d.title}` : `${d.id} ${d.title} (not searchable yet)`)),
    results: r.hits.map((h) => ({
      document_id: h.documentId,
      document: h.title,
      about: [h.manufacturer, h.model].filter(Boolean).join(' ') || null,
      pages: h.firstPage === h.lastPage ? `${h.firstPage}` : `${h.firstPage}–${h.lastPage}`,
      printed_page: printed.get(`${h.documentId}:${h.firstPage}`),
      found_by: h.by.join(' and '),
      text: h.text,
      read: readerUrl(origin, h.documentId, h.firstPage, query),
    })),
    note:
      'Pages are PDF pages, from 1. A result is a passage that may span pages; read_pages gives the full text ' +
      'around it before you quote or rely on it.',
  };
}

export async function readPagesTool(db: Scoped, origin: string, args: { document: number; from: number; to?: number }) {
  const doc = await getDocument(db, args.document);
  if (!doc) throw new ToolError(`No document ${args.document} that you can read. list_documents gives the ids.`);
  const total = doc.pageCount ?? doc.pagesExtracted;
  const from = Math.max(1, Math.floor(args.from));
  const to = Math.min(Math.floor(args.to ?? from), from + MAX_PAGES - 1, total || from);
  if (total && from > total) throw new ToolError(`${doc.title} has ${total} pages.`);
  const [pages, context] = await Promise.all([readPages(db, doc.id, from, to), pageContext(db, doc.id, from, to)]);
  return {
    document_id: doc.id,
    document: doc.title,
    pages_in_document: total || null,
    pages: pages.map((p) => ({
      page: p.page,
      printed: context.get(p.page)?.label ?? undefined,
      section: context.get(p.page)?.section ?? undefined,
      text: p.text,
      read: readerUrl(origin, doc.id, p.page),
    })),
    note:
      (to - from + 1 < (args.to ?? from) - from + 1 ? `At most ${MAX_PAGES} pages per call. ` : '') +
      'Pages are PDF pages, from 1; printed is the number on the page itself where known. Cite by PDF page (the markers ' +
      'and links use it), and give the printed number beside it when there is one: "p. 812 (PDF p. 824)".',
  };
}

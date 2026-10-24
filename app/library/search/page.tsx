import Form from 'next/form';
import Link from 'next/link';

import { PageHeader } from '@/app/_ui/layout';
import { BUTTON, FIELD } from '@/app/_ui/styles';
import { requireAccount } from '@/lib/access';
import { searchCorpus, type SearchResult } from '@/lib/search';
import { listMyGroups } from '@/lib/study';

// Searching the corpus from the app (REQUIREMENTS K-2, K-3, K-7): the same
// search Claude uses (lib/search.ts), by words and meaning together. Scope:
// "mine" (your documents, picks and your gear's manuals), the whole library,
// or one study group's reading list. Each passage links to the page reader at
// its first page with the query's words marked. A plain form: the address
// holds the query, so a search can be bookmarked or shared with a member.

export const metadata = { title: 'Search · Bottega' };

type Props = { searchParams: Promise<{ q?: string; scope?: string }> };

const pagesLabel = (a: number, b: number) => (a === b ? `PDF p. ${a}` : `PDF pp. ${a}–${b}`);

export default async function SearchPage({ searchParams }: Props) {
  const { db } = await requireAccount();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 500);
  const scope = sp.scope ?? 'mine';
  const { groups } = await listMyGroups(db);
  const groupId = scope.startsWith('group:') ? Number(scope.slice(6)) : null;
  const group = groupId ? groups.find((g) => g.id === groupId) ?? null : null;

  let result: SearchResult | null = null;
  if (q) {
    result = await searchCorpus(db, {
      query: q,
      scope: scope === 'all' ? 'all' : 'mine',
      groupId: group ? group.id : null,
      limit: 20,
    });
  }

  return (
    <div className="max-w-4xl">
      <PageHeader back={{ href: '/library', label: 'Library' }} title="Search the manuals and books" />
      <Form action="/library/search" className="t-body mb-6 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="What to look for, in plain words: chop a sample into pads"
          aria-label="Search"
          className={`${FIELD} min-w-0 flex-1`}
          autoFocus
        />
        <select name="scope" defaultValue={group ? `group:${group.id}` : scope === 'all' ? 'all' : 'mine'} aria-label="Where" className={FIELD}>
          <option value="mine">My documents and gear manuals</option>
          <option value="all">The whole library too</option>
          {groups.map((g) => (
            <option key={g.id} value={`group:${g.id}`}>
              {g.name}: reading list
            </option>
          ))}
        </select>
        <button className={BUTTON}>Search</button>
      </Form>

      {result && (
        <>
          <p className="t-body mb-3 text-muted">
            {result.hits.length
              ? `${result.hits.length} ${result.hits.length === 1 ? 'passage' : 'passages'}`
              : 'Nothing found'}{' '}
            in {result.documents.length} {result.documents.length === 1 ? 'document' : 'documents'}
            {group ? ` on ${group.name}'s reading list` : ''}
            {result.meaning ? '' : ' · by words only (the meaning search did not answer)'}
            {result.documents.some((d) => !d.searchable) ? ` · ${result.documents.filter((d) => !d.searchable).length} not searchable yet` : ''}
          </p>
          <ol className="t-body divide-y divide-line border-y border-line">
            {result.hits.map((h, i) => (
              <li key={`${h.documentId}-${h.firstPage}-${i}`} className="py-3">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/library/${h.documentId}/read?page=${h.firstPage}&q=${encodeURIComponent(q)}`} className="font-medium hover:text-rust">
                    {h.title}, {pagesLabel(h.firstPage, h.lastPage)}
                  </Link>
                  {(h.manufacturer || h.model) && <span className="text-muted">{[h.manufacturer, h.model].filter(Boolean).join(' ')}</span>}
                  <span className="ml-auto t-small text-muted">by {h.by.join(' and ')}</span>
                </p>
                <p className="mt-1 max-w-prose whitespace-pre-wrap text-muted">{h.text.length > 700 ? `${h.text.slice(0, 700)}…` : h.text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-2 t-small text-muted">Pages are PDF pages, from 1; printed page numbers may differ.</p>
        </>
      )}
    </div>
  );
}

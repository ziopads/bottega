import Link from 'next/link';
import { notFound } from 'next/navigation';

import PageNav from '@/app/_library/PageNav';
import { PageHeader, Section } from '@/app/_ui/layout';
import { requireAccount } from '@/lib/access';
import { getDocument, getSections, pageContext, readPages } from '@/lib/documents';

// The page reader (REQUIREMENTS K-3): one page of a document's text as
// Bottega extracted it, with the PDF itself at that page beside it on
// request. Search results and the connector's citations link here
// (/library/15/read?page=212&q=chop), so a citation can be checked. Pages
// are PDF pages from 1, which may differ from the numbers printed on them.
// A document the person cannot see is a 404. The PDF beside the text lives in
// this route's layout.tsx, which stays mounted as the page changes.

export const metadata = { title: 'Read · Bottega' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; q?: string }> };

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'how', 'what', 'are', 'you', 'your']);

/** The page's text with the query's words marked. */
function marked(text: string, q: string): React.ReactNode[] {
  const words = Array.from(new Set(q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])).filter((w) => !STOP.has(w));
  if (!words.length) return [text];
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="bg-rust/20 text-ink">{part}</mark> : part));
}

export default async function ReadPage({ params, searchParams }: Props) {
  const { db } = await requireAccount();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const doc = await getDocument(db, id);
  if (!doc) notFound();
  const sp = await searchParams;
  const total = doc.pageCount ?? doc.pagesExtracted;
  const asked = Math.floor(Number(sp.page) || 1);
  const page = Math.min(Math.max(1, asked), Math.max(1, total));
  const q = (sp.q ?? '').slice(0, 200);
  const [[text], sections, context] = await Promise.all([readPages(db, id, page, page), getSections(db, id), pageContext(db, id, page, page)]);
  const here = context.get(page);
  // The section this page is in: the last one starting at or before it.
  const current = sections.reduce<number>((at, s, i) => (s.page <= page ? i : at), -1);

  return (
    <div>
      <PageHeader
        back={{ href: `/library/${id}`, label: doc.title }}
        title={`${doc.title}, PDF page ${page}${here?.label ? ` · printed p. ${here.label}` : ''}`}
        meta={[
          here?.section ? `in ${here.section}` : null,
          total ? `${total} pages` : null,
          here?.label ? 'PDF pages count from 1' : 'PDF pages count from 1; printed numbers may differ',
          q ? `marking “${q}”` : null,
        ]}
      />
      <PageNav documentId={id} page={page} total={total} q={q} />
      {sections.length > 0 && (
        <details className="t-body mb-4">
          <summary className="cursor-pointer text-muted hover:text-ink">Contents ({sections.length})</summary>
          <ol className="mt-2 max-h-80 space-y-0.5 overflow-y-auto border-l border-line pl-3">
            {sections.map((s, i) => (
              <li key={i} style={{ paddingLeft: `${(s.level - 1) * 12}px` }}>
                <Link
                  href={`/library/${id}/read?page=${s.page}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                  className={`flex gap-2 ${i === current ? 'text-rust' : 'hover:text-rust'}`}
                >
                  <span className="min-w-0 flex-1">{s.title}</span>
                  <span className="t-num text-[11px] text-muted">{s.page}</span>
                </Link>
              </li>
            ))}
          </ol>
        </details>
      )}
      <Section label="Text">
        {text ? (
          <div className="t-body max-w-prose whitespace-pre-wrap break-words leading-relaxed">{marked(text.text, q)}</div>
        ) : (
          <p className="t-body text-muted">
            {doc.pagesExtracted < page ? 'This page’s text has not been read yet. Processing reads it.' : 'This page carries no text.'}
          </p>
        )}
      </Section>
    </div>
  );
}

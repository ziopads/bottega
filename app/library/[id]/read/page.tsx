import Link from 'next/link';
import { notFound } from 'next/navigation';

import PdfPane from '@/app/_library/PdfPane';
import { PageHeader, Section } from '@/app/_ui/layout';
import { FIELD } from '@/app/_ui/styles';
import { requireAccount } from '@/lib/access';
import { getDocument, readPages } from '@/lib/documents';

// The page reader (REQUIREMENTS K-3): one page of a document's text as
// Bottega extracted it, with the PDF itself at that page beside it on
// request. Search results and the connector's citations link here
// (/library/15/read?page=212&q=chop), so a citation can be checked. Pages
// are PDF pages from 1, which may differ from the numbers printed on them.
// A document the person cannot see is a 404.

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
  const [text] = await readPages(db, id, page, page);
  const href = (n: number) => `/library/${id}/read?page=${n}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <div>
      <PageHeader
        back={{ href: `/library/${id}`, label: doc.title }}
        title={`${doc.title}, PDF page ${page}`}
        meta={[total ? `${total} pages` : null, 'PDF pages count from 1; printed numbers may differ', q ? `marking “${q}”` : null]}
      />
      <nav className="t-body mb-6 flex flex-wrap items-center gap-3">
        {page > 1 ? (
          <Link href={href(page - 1)} className="text-muted hover:text-ink">
            ← Page {page - 1}
          </Link>
        ) : (
          <span className="text-muted/50">← Previous</span>
        )}
        <form action={`/library/${id}/read`} className="flex items-center gap-1.5">
          <label className="text-muted" htmlFor="page">
            Page
          </label>
          <input id="page" name="page" type="number" min={1} max={total || undefined} defaultValue={page} className={`${FIELD} w-20`} />
          {q && <input type="hidden" name="q" value={q} />}
        </form>
        {page < total ? (
          <Link href={href(page + 1)} className="text-muted hover:text-ink">
            Page {page + 1} →
          </Link>
        ) : (
          <span className="text-muted/50">Next →</span>
        )}
      </nav>
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
        <Section label="Text">
          {text ? (
            <div className="t-body max-w-prose whitespace-pre-wrap break-words leading-relaxed">{marked(text.text, q)}</div>
          ) : (
            <p className="t-body text-muted">
              {doc.pagesExtracted < page ? 'This page’s text has not been read yet. Processing reads it.' : 'This page carries no text.'}
            </p>
          )}
        </Section>
        <Section label="The PDF">
          <PdfPane documentId={id} page={page} />
        </Section>
      </div>
    </div>
  );
}

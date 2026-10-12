import Link from 'next/link';

import { citationLabel, parseBody, readerHref, type Citation, type Inline } from '@/lib/citations';

// A lesson's body as a reader sees it (lib/citations.ts): headings,
// paragraphs and lists, with each citation marker shown as a numbered link to
// the page reader, and the sources listed at the foot. A citation of a
// document the viewer cannot read says so, so the custodian knows to share it
// with the group. No hooks: server and client components both use it.

type Titles = Map<number, string | null>;

function Cite({ citation, n, titles }: { citation: Citation; n: number; titles: Titles }) {
  const title = titles.get(citation.documentId);
  const label = `${title ?? `Document ${citation.documentId}`}, ${citationLabel(citation)}`;
  if (!title) {
    return (
      <sup className="t-num text-muted" title={`${label} (not readable by you)`}>
        [{n}]
      </sup>
    );
  }
  return (
    <sup className="t-num">
      <Link href={readerHref(citation)} title={citation.quote ? `${label}: “${citation.quote}”` : label} className="text-rust hover:underline">
        [{n}]
      </Link>
    </sup>
  );
}

function Line({ parts, titles }: { parts: Inline[]; titles: Titles }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'bold') return <strong key={i}>{p.text}</strong>;
        if (p.kind === 'code') return <code key={i} className="rounded bg-card px-1 font-mono text-[12px]">{p.text}</code>;
        if (p.kind === 'cite') return <Cite key={i} citation={p.citation} n={p.n} titles={titles} />;
        return <span key={i}>{p.text}</span>;
      })}
    </>
  );
}

export default function LessonBody({ body, titles, compact = false }: { body: string; titles: Titles; compact?: boolean }) {
  const { blocks, sources } = parseBody(body);
  return (
    <div className={`t-body max-w-prose leading-relaxed ${compact ? 'space-y-2' : 'space-y-3'}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          return b.level === 2 ? (
            <h3 key={i} className="t-lead mt-5 font-semibold">
              <Line parts={b.inline} titles={titles} />
            </h3>
          ) : (
            <h4 key={i} className="mt-4 font-semibold">
              <Line parts={b.inline} titles={titles} />
            </h4>
          );
        }
        if (b.kind === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} className={`${b.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Line parts={item} titles={titles} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i}>
            <Line parts={b.inline} titles={titles} />
          </p>
        );
      })}

      {sources.length > 0 && (
        <div className="mt-6 border-t border-line pt-2">
          <p className="t-label mb-1">Sources</p>
          <ol className="space-y-1 text-[12px]">
            {sources.map(({ n, citation }) => {
              const title = titles.get(citation.documentId);
              return (
                <li key={n} className="flex gap-2">
                  <span className="t-num w-6 shrink-0 text-muted">[{n}]</span>
                  <span className="min-w-0">
                    {title ? (
                      <Link href={readerHref(citation)} className="hover:text-rust">
                        {title}, {citationLabel(citation)}
                      </Link>
                    ) : (
                      <span className="text-muted">
                        Document {citation.documentId}, {citationLabel(citation)} · not readable by you
                      </span>
                    )}
                    {citation.quote && <span className="text-muted"> · “{citation.quote}”</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Document titles by id, from the group's documents. */
export function titlesOf(docs: { id: number; title: string | null }[]): Titles {
  return new Map(docs.map((d) => [d.id, d.title]));
}

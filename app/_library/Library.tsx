'use client';

import Link from 'next/link';

import Upload from '@/app/_library/Upload';
import type { Allowance, StudioDocument } from '@/lib/documentTypes';
import { DOCUMENT_KIND_LABEL, REVIEW_LABEL, STATE_LABEL } from '@/lib/documentTypes';
import { formatBytes } from '@/lib/studioTypes';

// The library and the person's own documents (REQUIREMENTS §8): adding
// documents, one or a batch (Upload.tsx, with the duplicate check, K-8), the
// allowance (K-10), and the lists by where a document stands. The routes and the database enforce every rule shown.

export default function Library({
  documents,
  allowance,
  viewerId,
  isAdmin,
}: {
  documents: StudioDocument[];
  allowance: Allowance | null;
  viewerId: string;
  isAdmin: boolean;
}) {
  const mine = documents.filter((d) => !d.library && d.ownerId === viewerId);
  const shared = documents.filter((d) => !d.library && d.ownerId !== viewerId);
  const submissions = documents.filter((d) => d.library && d.contributedBy === viewerId && d.reviewStatus !== 'approved');
  const queue = isAdmin ? documents.filter((d) => d.library && d.reviewStatus === 'submitted' && d.contributedBy !== viewerId) : [];
  const library = documents.filter((d) => d.library && d.reviewStatus === 'approved');

  return (
    <div className="space-y-10">
      <Upload />
      {allowance && <AllowanceLine a={allowance} />}
      {queue.length > 0 && <Section title="Awaiting your review" docs={queue} />}
      {submissions.length > 0 && <Section title="Your submissions" docs={submissions} />}
      <Section title="Your documents" docs={mine} empty="Nothing private yet. Books and anything not for the library go here." />
      {shared.length > 0 && <Section title="Shared with you" docs={shared} />}
      <Section title="Library" docs={library} empty="The library is empty. Upload a manual to start it." />
    </div>
  );
}

function AllowanceLine({ a }: { a: Allowance }) {
  const parts = [
    a.storageBytes === null
      ? `${formatBytes(a.storageUsed) || '0 KB'} stored`
      : `${formatBytes(a.storageUsed) || '0 KB'} of ${formatBytes(a.storageBytes)} stored`,
    a.pagesPerMonth === null
      ? `${a.pagesUsed.toLocaleString()} pages processed this month`
      : `${a.pagesUsed.toLocaleString()} of ${a.pagesPerMonth.toLocaleString()} pages processed this month`,
  ];
  return <p className="text-[11px] text-muted">{parts.join(' · ')}</p>;
}

function Section({ title, docs, empty }: { title: string; docs: StudioDocument[]; empty?: string }) {
  return (
    <section>
      <h2 className="t-label mb-3 border-b border-line pb-1">{title}</h2>
      {docs.length === 0 ? (
        <p className="t-body text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 t-body">
              <Link href={`/library/${d.id}`} className="font-medium hover:text-rust">
                {d.title}
              </Link>
              {(d.manufacturer || d.model) && <span className="text-muted">{[d.manufacturer, d.model].filter(Boolean).join(' ')}</span>}
              {d.kind !== 'manual' && <span className="text-muted">{DOCUMENT_KIND_LABEL[d.kind]}</span>}
              {d.library && d.reviewStatus !== 'approved' && <span className="text-rust">{REVIEW_LABEL[d.reviewStatus]}</span>}
              <span className="ml-auto text-[11px] text-muted">
                {d.state === 'ready' ? `${d.pageCount ?? 0} pages` : STATE_LABEL[d.state]}
                {d.picked ? ' · picked' : ''}
                {!d.library && d.ownerName && d.level !== 'owner' ? ` · ${d.ownerName}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

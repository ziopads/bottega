'use client';

import { useState } from 'react';

import { BUTTON } from '@/app/_ui/styles';

// The PDF beside the page reader's text, opened on request: a large book is
// not fetched until someone wants to see the page itself. Once open it stays
// open as the reader moves between pages, which then only changes the page.

export default function PdfPane({ documentId, page }: { documentId: number; page: number }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="t-body text-muted">
        <button type="button" onClick={() => setOpen(true)} className={BUTTON}>
          Show page {page} of the PDF
        </button>
        <p className="mt-2 text-[11px]">Opens the whole file in your browser&rsquo;s PDF viewer, at this page; a large book takes a moment.</p>
      </div>
    );
  }
  return (
    <iframe
      key={page}
      title={`PDF page ${page}`}
      src={`/api/documents/${documentId}/file?inline=1#page=${page}`}
      className="h-[80vh] w-full rounded border border-line"
    />
  );
}

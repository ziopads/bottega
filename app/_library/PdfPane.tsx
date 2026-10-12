'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON } from '@/app/_ui/styles';

// The PDF beside the page reader's text, opened on request: a large book is
// not fetched until someone wants to see the page itself.
//
// The file is loaded once. Opening the pane asks for the reader's link (signed
// for a fixed window, so it is the same address on every request and the
// browser can keep the file in its cache); turning the page then changes only
// the #page part of the frame's address, which the browser's PDF viewer
// follows without fetching the file again. The viewer's own toolbar is hidden:
// it does not fit the column, and the reader's controls above turn the page.

const VIEW = 'toolbar=0&navpanes=0&view=FitH';

export default function PdfPane({ documentId, page }: { documentId: number; page: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    setBusy(true);
    setError('');
    const r = await api<{ url: string }>(`/api/documents/${documentId}/file?reader=1`, { method: 'GET' });
    setBusy(false);
    if (!r.ok) return setError(r.body.error || 'Could not open the PDF.');
    setUrl(r.data.url);
  }

  if (!url) {
    return (
      <div className="t-body text-muted">
        <button type="button" onClick={open} disabled={busy} className={BUTTON}>
          {busy ? 'Opening…' : `Show page ${page} of the PDF`}
        </button>
        <p className="mt-2 text-[11px]">
          Loads the whole file into your browser&rsquo;s PDF viewer once; after that, turning the page only moves the viewer.
        </p>
        {error && <p className="mt-2 text-rust">{error}</p>}
      </div>
    );
  }
  return (
    <div>
      <iframe title="The PDF" src={`${url}#page=${page}&${VIEW}`} className="h-[80vh] w-full rounded border border-line" />
      <p className="mt-1 text-[11px] text-muted">
        <a href={`${url}#page=${page}`} target="_blank" rel="noreferrer" className="hover:text-ink">
          Open in a new tab
        </a>{' '}
        for the viewer&rsquo;s own tools: zoom, search, print.
      </p>
    </div>
  );
}

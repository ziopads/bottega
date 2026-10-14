'use client';

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON } from '@/app/_ui/styles';

// The PDF beside the page reader's text, drawn by PDF.js one page at a time.
//
// The pane sits in the reader's layout, which stays mounted as the page
// changes, and takes the page number from the address (?page=), so the
// reader's arrows, field and scrubber turn it, and so do the arrows here. It
// asks the file route once for the reader's link (signed for a fixed window,
// lib/files.ts signReaderGet) and opens the document from it with byte
// ranges: PDF.js reads the file's table of objects, then only what each page
// it draws needs, so page 824 of a 94 MB book costs a few hundred KB, not the
// book. R2 answers ranges with 206 and its CORS rule exposes Content-Range,
// Accept-Ranges and Content-Length (checked 14 October); without those PDF.js
// would quietly fetch the whole file.
//
// Each page is drawn to a new canvas at the column's width times the zoom, at
// the screen's pixel density, and swapped in when finished, so the old page
// stays until the new one is ready. Fit width is the default; at a larger zoom
// the frame scrolls both ways. No text layer yet: "Open in a new tab" gives
// the browser's viewer for searching, selecting and printing.

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const CHUNK = 256 * 1024;

type PdfJs = typeof import('pdfjs-dist');
let pdfjsLoading: Promise<PdfJs> | null = null;

/** PDF.js and its worker, loaded on first use and shared by every pane in the tab. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoading ??= import('pdfjs-dist')
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
      return pdfjs;
    })
    .catch((e) => {
      pdfjsLoading = null;
      throw e;
    });
  return pdfjsLoading;
}

const cancelled = (e: unknown) => (e as { name?: string } | null)?.name === 'RenderingCancelledException';

export default function PdfPane({ documentId }: { documentId: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const asked = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const q = params.get('q') ?? '';

  const [url, setUrl] = useState<string | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [shown, setShown] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);

  const total = doc?.numPages ?? 0;
  const page = total ? Math.min(asked, total) : asked;

  // The page field: typed freely, sent on Enter, back to the page shown on leaving it or when the page changes.
  const [field, setField] = useState(String(page));
  const [fieldFor, setFieldFor] = useState(page);
  if (fieldFor !== page) {
    setFieldFor(page);
    setField(String(page));
  }

  // Open the document: the signed link, then PDF.js reads the file's structure by range.
  useEffect(() => {
    let gone = false;
    let task: PDFDocumentLoadingTask | null = null;
    (async () => {
      const r = await api<{ url: string }>(`/api/documents/${documentId}/file?reader=1`, { method: 'GET' });
      if (gone) return;
      if (!r.ok) return setError(r.body.error || 'Could not open the PDF.');
      setUrl(r.data.url);
      try {
        const pdfjs = await loadPdfJs();
        if (gone) return;
        task = pdfjs.getDocument({ url: r.data.url, rangeChunkSize: CHUNK, disableAutoFetch: true, disableStream: true });
        const d = await task.promise;
        if (!gone) setDoc(d);
      } catch {
        if (!gone) setError('Could not open the PDF.');
      }
    })();
    return () => {
      gone = true;
      void task?.destroy();
    };
  }, [documentId]);

  // The frame's inner width, which a page fits at zoom 1.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw the page: to a new canvas, swapped in when done; a newer request cancels an older one.
  const lastPage = useRef(0);
  useEffect(() => {
    if (!doc || !width) return;
    let gone = false;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (gone) return;
        const viewport = p.getViewport({ scale: (width / p.getViewport({ scale: 1 }).width) * zoom });
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.className = 'block bg-white';
        task = p.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
        await task.promise;
        if (gone) return;
        holder.current?.replaceChildren(canvas);
        if (lastPage.current !== page) frame.current?.scrollTo({ top: 0, left: 0 });
        lastPage.current = page;
        setShown(page);
        setError('');
      } catch (e) {
        if (!gone && !cancelled(e)) setError(`Could not draw page ${page}.`);
      }
    })();
    return () => {
      gone = true;
      task?.cancel();
    };
  }, [doc, page, width, zoom]);

  function go(to: number) {
    const n = Math.min(Math.max(1, to), total || to);
    if (n !== page) router.push(`/library/${documentId}/read?page=${n}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { scroll: false });
  }
  const z = ZOOMS.indexOf(zoom);
  const status = error ? '' : !doc ? 'Opening…' : shown !== page ? `Drawing page ${page}…` : '';

  return (
    <div>
      <div className="t-body mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-muted">
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(page - 1)}
            disabled={!doc || page <= 1}
            className="px-1 text-base leading-none hover:text-ink disabled:opacity-30"
            aria-label="Previous page"
          >
            ‹
          </button>
          <input
            type="number"
            value={field}
            min={1}
            max={total || undefined}
            onChange={(e) => setField(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const n = Number.parseInt(field, 10);
              if (!Number.isNaN(n)) go(n);
            }}
            onBlur={() => setField(String(page))}
            className="t-num w-16 rounded border border-line bg-card px-1.5 py-0.5 text-center text-ink outline-none focus:border-rust"
            aria-label="Go to PDF page"
          />
          <span className="t-num">{total ? `of ${total}` : ''}</span>
          <button
            type="button"
            onClick={() => go(page + 1)}
            disabled={!doc || page >= total}
            className="px-1 text-base leading-none hover:text-ink disabled:opacity-30"
            aria-label="Next page"
          >
            ›
          </button>
        </span>
        {status && <span className="text-[11px]">{status}</span>}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setZoom(ZOOMS[z - 1])} disabled={z <= 0} className={BUTTON} aria-label="Zoom out">
            −
          </button>
          <span className="t-num w-12 text-center text-[11px]">{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
          <button type="button" onClick={() => setZoom(ZOOMS[z + 1])} disabled={z >= ZOOMS.length - 1} className={BUTTON} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1} className={BUTTON}>
            Fit width
          </button>
        </span>
      </div>
      <div ref={frame} className="h-[80vh] overflow-auto rounded border border-line bg-ink/5 [scrollbar-gutter:stable]">
        {error ? <p className="t-body p-3 text-rust">{error}</p> : null}
        <div ref={holder} className={`mx-auto w-max ${error ? 'hidden' : ''}`} />
      </div>
      {url && (
        <p className="mt-1 text-[11px] text-muted">
          <a href={`${url}#page=${page}`} target="_blank" rel="noreferrer" className="hover:text-ink">
            Open in a new tab
          </a>{' '}
          for the browser&rsquo;s viewer: search, select text, print.
        </p>
      )}
    </div>
  );
}

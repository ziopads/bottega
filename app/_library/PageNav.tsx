'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

// The page reader's ways off a page, as in Scriptorium's page view: ‹ and ›,
// the left and right arrow keys, a page typed into the field (Enter), and the
// scrubber for crossing a long book in one drag. The scrubber moves a local
// number while dragging and navigates once on release, since navigating per
// pixel would be a server round trip per pixel.

export default function PageNav({ documentId, page, total, q }: { documentId: number; page: number; total: number; q: string }) {
  const router = useRouter();
  const [field, setField] = useState(String(page));
  const [scrub, setScrub] = useState<number | null>(null);
  const last = Math.max(1, total);

  const go = useCallback(
    (to: number) => {
      const n = Math.min(Math.max(1, Math.round(to)), last);
      if (n === page) return;
      router.push(`/library/${documentId}/read?page=${n}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    },
    [documentId, last, page, q, router],
  );

  // A new page arrived: the field and the scrubber follow it.
  const [shownFor, setShownFor] = useState(page);
  if (shownFor !== page) {
    setShownFor(page);
    setField(String(page));
    setScrub(null);
  }

  // ← and → turn the page, except while typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'ArrowRight' && page < last) {
        e.preventDefault();
        go(page + 1);
      } else if (e.key === 'ArrowLeft' && page > 1) {
        e.preventDefault();
        go(page - 1);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, last, page]);

  const shown = scrub ?? page;
  const release = () => scrub !== null && go(scrub);

  return (
    <div className="t-body mb-6 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go(page - 1)}
            disabled={page <= 1}
            className="px-1 t-lead leading-none hover:text-ink disabled:opacity-30"
            aria-label="Previous page"
          >
            ‹
          </button>
          <input
            type="number"
            value={field}
            min={1}
            max={last}
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
          <button
            type="button"
            onClick={() => go(page + 1)}
            disabled={page >= last}
            className="px-1 t-lead leading-none hover:text-ink disabled:opacity-30"
            aria-label="Next page"
          >
            ›
          </button>
        </span>
        <span className="t-num">of {last}</span>
        {scrub !== null && scrub !== page ? <span className="text-ink">page {scrub}, release to go</span> : <span>← and → turn the page</span>}
      </div>
      <input
        type="range"
        className="scrubber"
        min={1}
        max={last}
        value={shown}
        onChange={(e) => setScrub(Number.parseInt(e.target.value, 10))}
        onMouseUp={release}
        onTouchEnd={release}
        onKeyUp={release}
        aria-label={`Page ${shown} of ${last}`}
      />
    </div>
  );
}

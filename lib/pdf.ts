import { createHash } from 'node:crypto';
import { getDocumentProxy } from 'unpdf';

// Server-only. Reading a stored PDF for processing (REQUIREMENTS K-1, K-9):
// its fingerprint, its page count, and its text page by page. unpdf bundles
// a serverless build of PDF.js, so this runs in a Vercel function.

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface PdfText {
  pageCount: number;
  /** Text of pages from..to (1-based, inclusive), in order. */
  pages: { page: number; text: string }[];
}

/**
 * Page count and the text of pages from..to. PDF.js parses the whole file
 * once; extraction is then per page, so a long document is read across calls
 * by passing successive ranges.
 */
export async function readPdfPages(bytes: Uint8Array, from: number, to: number): Promise<PdfText> {
  // PDF.js takes ownership of the buffer it is given; pass a copy so the
  // caller's bytes (already fingerprinted) stay usable.
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const pageCount = doc.numPages;
    const last = Math.min(to, pageCount);
    const pages: { page: number; text: string }[] = [];
    for (let n = Math.max(1, from); n <= last; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({ page: n, text: joinItems(content.items as { str?: string; hasEOL?: boolean }[]) });
      page.cleanup();
    }
    return { pageCount, pages };
  } finally {
    await doc.loadingTask.destroy();
  }
}

// PDF.js returns runs of text with end-of-line marks. A line break where it
// marks one; a blank line where two marks follow each other (a paragraph).
function joinItems(items: { str?: string; hasEOL?: boolean }[]): string {
  let out = '';
  for (const it of items) {
    if (typeof it.str === 'string') out += it.str;
    if (it.hasEOL) out += '\n';
  }
  return out
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * True when the extracted text is too thin to be a text layer: a scan, which
 * needs OCR first (REQUIREMENTS K-1). Judged on pages with any text at all
 * against the whole document.
 */
export function looksScanned(pageTexts: string[]): boolean {
  if (!pageTexts.length) return true;
  const chars = pageTexts.map((t) => t.replace(/\s/g, '').length);
  const total = chars.reduce((a, b) => a + b, 0);
  const thin = chars.filter((c) => c < 40).length;
  return total / pageTexts.length < 100 || thin / pageTexts.length > 0.6;
}

export interface PdfStructure {
  /** Printed page labels from the PDF, by PDF page from 1, where they differ from the page's place; null entries for the rest. */
  labels: (string | null)[];
  /** The outline (bookmarks), in order, with each entry's level and the PDF page it starts on. */
  outline: { level: number; title: string; page: number }[];
}

type OutlineNode = { title?: string; dest?: unknown; items?: OutlineNode[] };

/**
 * The PDF's own page labels and its outline, read in one pass (db/022). Both
 * are optional in a PDF: a file without them gives empty answers. Outline
 * entries whose destination cannot be resolved to a page are skipped.
 */
export async function readPdfStructure(bytes: Uint8Array): Promise<PdfStructure> {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const raw = ((await doc.getPageLabels()) as (string | null)[] | null) ?? [];
    const labels = raw.map((l, i) => {
      const t = typeof l === 'string' ? l.trim() : '';
      return t && t !== String(i + 1) && t.length <= 20 ? t : null;
    });

    const outline: PdfStructure['outline'] = [];
    const pageOf = async (dest: unknown): Promise<number | null> => {
      try {
        const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
        if (!Array.isArray(explicit) || !explicit.length) return null;
        const ref = explicit[0];
        const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref as never);
        return index + 1;
      } catch {
        return null;
      }
    };
    const walk = async (nodes: OutlineNode[], level: number) => {
      for (const n of nodes) {
        if (outline.length >= 2000) return;
        const title = (n.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        const page = await pageOf(n.dest);
        if (title && page) outline.push({ level: Math.min(level, 8), title, page });
        if (n.items?.length) await walk(n.items, level + 1);
      }
    };
    await walk(((await doc.getOutline()) as OutlineNode[] | null) ?? [], 1);
    return { labels, outline };
  } finally {
    await doc.loadingTask.destroy();
  }
}

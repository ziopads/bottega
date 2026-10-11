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

// Citation markers in a lesson's body (REQUIREMENTS L-1, M-4), and the light
// formatting lessons use. A plain module: the checker on the server and the
// renderer in the browser read the same grammar.
//
// A marker names a document, a PDF page (or a range) and, optionally, the
// words quoted from it:
//
//   [15:p42]                        document 15, PDF page 42
//   [15:p42-43]                     pages 42 to 43
//   [15:p42 "chop the sample"]      with a quotation, checked against the page
//
// Pages are PDF pages counted from 1, as in the page reader and the
// connector; printed page numbers may differ.
//
// Formatting: paragraphs split by blank lines; "## " and "### " headings;
// lines starting "- " or "* " as a bulleted list, "1. " as a numbered list;
// **bold** and `code` inside a line. Nothing else is interpreted, and no HTML
// is ever passed through.

export interface Citation {
  /** The marker as written. */
  raw: string;
  documentId: number;
  from: number;
  to: number;
  quote: string | null;
}

const MARKER = /\[(\d{1,9}):p(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?(?:\s+["“”]([^"“”\]]{1,600})["“”])?\]/g;

/** At most this many pages in one marker's range. */
export const CITATION_SPAN_MAX = 10;

export function parseCitations(body: string): Citation[] {
  const out: Citation[] = [];
  for (const m of body.matchAll(MARKER)) {
    const from = Number(m[2]);
    const to = m[3] ? Number(m[3]) : from;
    out.push({ raw: m[0], documentId: Number(m[1]), from, to, quote: m[4] ? m[4].trim() : null });
  }
  return out;
}

/**
 * Text as compared for a quotation: case, curly quotes, dashes, soft hyphens,
 * words broken across lines and runs of white space do not count.
 */
export function normalizeForQuote(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/­/g, '')
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function quoteFound(pageText: string, quote: string): boolean {
  const q = normalizeForQuote(quote);
  return q.length > 0 && normalizeForQuote(pageText).includes(q);
}

export const citationLabel = (c: Pick<Citation, 'from' | 'to'>) => (c.from === c.to ? `PDF p. ${c.from}` : `PDF pp. ${c.from}–${c.to}`);

export const readerHref = (c: Pick<Citation, 'documentId' | 'from'>) => `/library/${c.documentId}/read?page=${c.from}`;

// ── Formatting ──────────────────────────────────────────────────────────────

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'cite'; citation: Citation; n: number };

export type Block =
  | { kind: 'heading'; level: 2 | 3; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] };

/** Splits one line into text, bold, code and citations; n numbers citations by first appearance. */
function inline(line: string, numbering: Map<string, number>): Inline[] {
  const out: Inline[] = [];
  const re = new RegExp(`${MARKER.source}|\\*\\*([^*]+)\\*\\*|\`([^\`]+)\``, 'g');
  let last = 0;
  for (const m of line.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: line.slice(last, at) });
    if (m[5] !== undefined) out.push({ kind: 'bold', text: m[5] });
    else if (m[6] !== undefined) out.push({ kind: 'code', text: m[6] });
    else {
      const from = Number(m[2]);
      const citation: Citation = { raw: m[0], documentId: Number(m[1]), from, to: m[3] ? Number(m[3]) : from, quote: m[4] ? m[4].trim() : null };
      const key = `${citation.documentId}:${citation.from}-${citation.to}`;
      if (!numbering.has(key)) numbering.set(key, numbering.size + 1);
      out.push({ kind: 'cite', citation, n: numbering.get(key)! });
    }
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out;
}

export function parseBody(body: string): { blocks: Block[]; sources: { n: number; citation: Citation }[] } {
  const numbering = new Map<string, number>();
  const firstSeen = new Map<number, Citation>();
  const blocks: Block[] = [];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'paragraph', inline: inline(para.join(' '), numbering) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map((i) => inline(i, numbering)) });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d{1,3}[.)]\s+(.+)$/);
    if (!line) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: 'heading', level: heading[1].length === 2 ? 2 : 3, inline: inline(heading[2], numbering) });
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (list) {
      // A line under a list item continues it.
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      para.push(line);
    }
  }
  flushPara();
  flushList();

  const visit = (parts: Inline[]) => parts.forEach((p) => p.kind === 'cite' && !firstSeen.has(p.n) && firstSeen.set(p.n, p.citation));
  for (const b of blocks) {
    if (b.kind === 'list') b.items.forEach(visit);
    else visit(b.inline);
  }
  const sources = Array.from(firstSeen.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([n, citation]) => ({ n, citation }));
  return { blocks, sources };
}

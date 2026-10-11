// Page text into search windows. Ported from Scriptorium's pipeline/chunk.py
// without its language detection: Bottega's corpus is manuals, in English.
//
// A chunk is a run of whole paragraphs of roughly TARGET characters, never
// more than HARD_MAX, cut at paragraph ends or, inside a paragraph longer than
// HARD_MAX, at sentence or line ends. Consecutive chunks overlap by about
// OVERLAP characters, so a passage straddling a cut is whole in one of them.
// Pages are recorded (first and last page) but not respected as boundaries.
// Pages with fewer than MIN_PAGE_CHARS characters (covers, blanks, plates)
// are skipped.
//
// Smaller than Scriptorium's 2,800: a manual's answer is usually local (a
// menu path, a parameter table), so a hit should point at little more than
// that. Change a size here, bump CHUNKER_VERSION, and reprocess.

export const CHUNKER_VERSION = 1;

const TARGET = 2000;
const HARD_MAX = 2800;
const OVERLAP = 300;
const MIN_PAGE_CHARS = 40;

export interface PageText {
  page: number;
  text: string;
}

export interface Chunk {
  firstPage: number;
  lastPage: number;
  text: string;
}

// A sentence end: terminal punctuation, an optional closing quote or bracket,
// whitespace, then something that can begin a sentence.
const SENTENCE = /(?<=[.!?…]["”')\]]?)\s+(?=[A-Z0-9"“(])/;

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

/** A paragraph longer than HARD_MAX, cut at sentence ends, then at line ends (tables and lists have no sentences). */
function splitLong(paragraph: string): string[] {
  if (paragraph.length <= HARD_MAX) return [paragraph];
  const pieces: string[] = [];
  let current = '';
  const units = paragraph.split(SENTENCE).flatMap((s) => (s.length > HARD_MAX ? s.split('\n') : [s]));
  for (const unit of units) {
    if (current && current.length + 1 + unit.length > HARD_MAX) {
      pieces.push(current);
      current = unit;
    } else {
      current = current ? `${current} ${unit}` : unit;
    }
  }
  if (current) pieces.push(current);
  // A single unit longer than HARD_MAX (a run-on table) is cut where it must be.
  return pieces.flatMap((p) => {
    const out: string[] = [];
    for (let i = 0; i < p.length; i += HARD_MAX) out.push(p.slice(i, i + HARD_MAX));
    return out;
  });
}

/** The last ~want characters of text, cut forward to a sentence or word start. */
function tail(text: string, want: number): string {
  if (text.length <= want) return text;
  const cut = text.slice(-want);
  const m = SENTENCE.exec(cut);
  if (m) return cut.slice(m.index + m[0].length);
  const space = cut.indexOf(' ');
  return space >= 0 ? cut.slice(space + 1) : cut;
}

export function chunkPages(pages: PageText[]): Chunk[] {
  const pieces: { page: number; text: string }[] = [];
  for (const p of pages) {
    if (p.text.replace(/\s/g, '').length < MIN_PAGE_CHARS) continue;
    for (const para of paragraphs(p.text)) {
      for (const piece of splitLong(para)) pieces.push({ page: p.page, text: piece });
    }
  }

  const chunks: Chunk[] = [];
  let buf: { page: number; text: string }[] = [];
  let len = 0;
  let carry: { page: number; text: string } | null = null;

  const flush = () => {
    if (!buf.length) return;
    const body = buf.map((b) => b.text).join('\n\n');
    const text = carry ? `${carry.text}\n\n${body}` : body;
    const firstPage = carry ? carry.page : buf[0].page;
    chunks.push({ firstPage, lastPage: buf[buf.length - 1].page, text });
    const last = buf[buf.length - 1];
    carry = { page: last.page, text: tail(body, OVERLAP) };
    buf = [];
    len = 0;
  };

  for (const piece of pieces) {
    if (len && len + 2 + piece.text.length > TARGET) flush();
    buf.push(piece);
    len += (len ? 2 : 0) + piece.text.length;
  }
  flush();
  return chunks;
}

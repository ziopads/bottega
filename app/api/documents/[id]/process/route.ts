import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { chunkPages } from '@/lib/chunk';
import {
  allPageTexts,
  claimPages,
  commitBatch,
  deleteDocument,
  getAllowance,
  getDocument,
  getDocumentFile,
  readPages,
  recordTokens,
  setProcessingState,
  storePages,
} from '@/lib/documents';
import type { StudioDocument } from '@/lib/documentTypes';
import { embedConfigured, embedDocuments, EmbedError } from '@/lib/embed';
import { deleteFile, getFileBytes } from '@/lib/files';
import { looksScanned, readPdfPages, sha256Hex } from '@/lib/pdf';
import { levelAtLeast } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';
// One step must finish inside Vercel's limit (300 s on Hobby). A step is far
// shorter than that; the limit covers a slow PDF or a rate-limited embed.
export const maxDuration = 300;

/** Pages of text read per call during extraction. */
const EXTRACT_PAGES = 300;
/** Pages embedded per call: one claim against the allowance. */
const EMBED_PAGES = 40;

// POST /api/documents/:id/process
// One step of processing (REQUIREMENTS K-9), then the document as it now
// stands. The document's page calls this again while the state is
// 'processing' or 'pending'; closing the page pauses it, and the next call
// resumes from what the database records.
//
//   Extraction  download the PDF, check its fingerprint against the one
//               recorded at upload, count pages, refuse a document longer
//               than the person's limit, store up to EXTRACT_PAGES pages of
//               text. When the last page is stored, a document with almost
//               no text is marked needs_ocr. Costs nothing against the
//               allowance.
//   Embedding   claim up to EMBED_PAGES pages (claim_pages, K-10), chunk
//               them, embed the chunks, store them and advance pages_done in
//               one transaction. A claim that grants nothing pauses the
//               document. A batch whose embedding fails still counts the
//               pages it claimed.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const doc = await getDocument(db, id);
  if (!doc) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!levelAtLeast(doc.level, 'edit')) {
    return NextResponse.json({ error: 'Only the owner, an editor or the contributor can process this document.' }, { status: 403 });
  }
  if (doc.state === 'ready' || doc.state === 'needs_ocr') return NextResponse.json({ document: doc });
  if (!embedConfigured()) {
    return NextResponse.json({ error: 'The embedding service is not configured yet (VOYAGE_API_KEY).' }, { status: 503 });
  }

  const extracting = doc.pageCount === null || doc.pagesExtracted < doc.pageCount;
  try {
    return extracting ? await extract(account.db, doc) : await embed(account.db, doc);
  } catch (err) {
    if (err instanceof EmbedError) {
      await setProcessingState(db, id, { state: 'processing', detail: 'Waiting for the embedding service; trying again.' });
      return NextResponse.json(
        { error: err.message, retryAfter: err.retryAfter ?? 30, document: await getDocument(db, id) },
        { status: 503 },
      );
    }
    console.error('[process] failed', { id, err });
    await setProcessingState(db, id, { state: 'failed', detail: 'Processing stopped on an error. Try again, or ask the administrator.' });
    return NextResponse.json({ error: 'Processing failed.', document: await getDocument(db, id) }, { status: 500 });
  }
}

type Db = Parameters<typeof getDocument>[0];

async function extract(db: Db, doc: StudioDocument): Promise<NextResponse> {
  const file = await getDocumentFile(db, doc.id);
  if (!file) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const bytes = await getFileBytes(file.key);

  // The browser's fingerprint decided the dedupe; the stored file must match it.
  if (sha256Hex(bytes) !== file.sha256) {
    const key = await deleteDocument(db, doc.id);
    if (key) await deleteFile(key);
    return NextResponse.json(
      { error: 'The stored file does not match the fingerprint sent with it, so it has been removed. Upload it again.', deleted: true },
      { status: 409 },
    );
  }

  const from = doc.pagesExtracted + 1;
  const { pageCount, pages } = await readPdfPages(bytes, from, from + EXTRACT_PAGES - 1);

  if (pageCount === 0) {
    await setProcessingState(db, doc.id, { state: 'failed', detail: 'The PDF has no pages.', pageCount });
    return NextResponse.json({ document: await getDocument(db, doc.id) });
  }
  if (doc.pageCount === null) {
    const allowance = await getAllowance(db);
    const max = allowance?.maxDocumentPages ?? null;
    if (max !== null && pageCount > max) {
      await setProcessingState(db, doc.id, {
        state: 'failed',
        detail: `This document has ${pageCount} pages; the longest you can process is ${max}.`,
        pageCount,
      });
      return NextResponse.json({ document: await getDocument(db, doc.id) });
    }
  }

  await storePages(db, doc.id, pages);
  const extracted = from - 1 + pages.length;
  if (extracted >= pageCount) {
    const scanned = looksScanned(await allPageTexts(db, doc.id));
    await setProcessingState(db, doc.id, {
      state: scanned ? 'needs_ocr' : 'processing',
      detail: scanned ? 'Most pages carry no text; this looks like a scan.' : '',
      pageCount,
    });
  } else {
    await setProcessingState(db, doc.id, { state: 'processing', detail: `Reading text: ${extracted} of ${pageCount} pages`, pageCount });
  }
  return NextResponse.json({ document: await getDocument(db, doc.id) });
}

async function embed(db: Db, doc: StudioDocument): Promise<NextResponse> {
  const pageCount = doc.pageCount ?? 0;
  const from = doc.pagesDone + 1;
  const want = Math.min(EMBED_PAGES, pageCount - doc.pagesDone);
  if (want <= 0) {
    await setProcessingState(db, doc.id, { state: 'ready' });
    return NextResponse.json({ document: await getDocument(db, doc.id) });
  }

  const { usageId, granted } = await claimPages(db, doc.id, want);
  if (granted === 0) {
    const allowance = await getAllowance(db);
    const detail =
      allowance && allowance.platformPagesLeft === 0
        ? 'Bottega has reached its processing limit for the month. It resumes next month.'
        : 'You have used this month’s processing allowance. It resumes next month, or ask the administrator to raise it.';
    await setProcessingState(db, doc.id, { state: 'paused', detail });
    return NextResponse.json({ document: await getDocument(db, doc.id) });
  }

  const to = from + granted - 1;
  const chunks = chunkPages(await readPages(db, doc.id, from, to));
  let vectors: number[][] = [];
  if (chunks.length) {
    const result = await embedDocuments(chunks.map((c) => c.text));
    vectors = result.vectors;
    await recordTokens(db, usageId, result.tokens);
  }
  const committed = await commitBatch(
    db,
    doc.id,
    doc.pagesDone,
    to,
    chunks.map((c, i) => ({ ...c, vector: vectors[i] })),
    to >= pageCount ? 'ready' : 'processing',
  );
  if (!committed) {
    return NextResponse.json({ document: await getDocument(db, doc.id), note: 'Another request processed these pages.' });
  }
  return NextResponse.json({ document: await getDocument(db, doc.id) });
}

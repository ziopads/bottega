import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { createDocument, fingerprintMatch, getDocument, linkModel, listDocuments } from '@/lib/documents';
import { DOCUMENT_CONTENT_TYPE, DOCUMENT_KINDS, isSha256, LIBRARY_KINDS, type DocumentKind } from '@/lib/documentTypes';
import { deleteFile, FILE_MAX_BYTES, fileObject, filesConfigured, isDocumentKey } from '@/lib/files';

export const dynamic = 'force-dynamic';

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// GET /api/documents — every document the person can see (the database decides).
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  return NextResponse.json({ documents: await listDocuments(account.db) });
}

// POST /api/documents   { key, library, title, manufacturer, model, kind, filename, sha256, modelId? }
// Step 2 of 2: record an upload that has reached storage. The key must be one
// issued to this person (or the library); size and type are read back from
// R2. The fingerprint is the browser's until the first processing step
// recomputes it from the stored file and refuses a mismatch (K-8).
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db, userId } = account;
  if (!filesConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured yet (R2_FILES_BUCKET).' }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const library = body.library === true;
  const key = typeof body.key === 'string' ? body.key : '';
  const title = text(body.title, 300);
  const filename = text(body.filename, 255);
  // The library holds manufacturers' documents only (open decision 10, db/005).
  const allowed = library ? LIBRARY_KINDS : DOCUMENT_KINDS;
  const kind: DocumentKind = allowed.includes(body.kind as DocumentKind) ? (body.kind as DocumentKind) : library ? 'manual' : 'other';
  if (!title) return NextResponse.json({ error: 'A title is needed.' }, { status: 400 });
  if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
  if (!isSha256(body.sha256)) return NextResponse.json({ error: 'Missing fingerprint' }, { status: 400 });
  if (!isDocumentKey(key, library ? null : userId)) return NextResponse.json({ error: 'Invalid upload key' }, { status: 400 });

  const stored = await fileObject(key);
  if (!stored) return NextResponse.json({ error: 'The upload did not reach storage. Please try again.' }, { status: 409 });
  if (stored.contentType !== DOCUMENT_CONTENT_TYPE || stored.bytes > FILE_MAX_BYTES) {
    await deleteFile(key);
    return NextResponse.json({ error: 'The stored file is not an accepted type or size.' }, { status: 400 });
  }

  const created = await createDocument(db, {
    library,
    kind,
    title,
    manufacturer: text(body.manufacturer, 200),
    model: text(body.model, 200),
    key,
    filename,
    bytes: stored.bytes,
    sha256: body.sha256,
  });
  if (!created.ok) {
    // Someone recorded the same file between the check and now.
    await deleteFile(key);
    return NextResponse.json(
      { error: 'Bottega already has this file.', match: await fingerprintMatch(db, body.sha256) },
      { status: 409 },
    );
  }

  const modelId = Number(body.modelId);
  if (library && Number.isInteger(modelId) && modelId > 0) await linkModel(db, created.id, modelId);

  return NextResponse.json({ document: await getDocument(db, created.id) }, { status: 201 });
}

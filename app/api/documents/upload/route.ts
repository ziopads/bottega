import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { fingerprintMatch, getAllowance, storageAllows } from '@/lib/documents';
import { DOCUMENT_CONTENT_TYPE, isSha256 } from '@/lib/documentTypes';
import { DOCUMENT_MAX_BYTES, filesConfigured, newDocumentKey, signFileUpload } from '@/lib/files';
import { formatBytes } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

// POST /api/documents/upload   { library, filename, bytes, sha256 }
// Step 1 of 2: a signed PUT for a PDF, under the uploader's prefix or the
// library's (ARCHITECTURE §12). Refused when Bottega already holds the file
// (K-8; the page asks /api/documents/check first and offers the existing
// copy) or when it would take the person past their storage allowance
// (K-10). Then POST /api/documents.
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
  const bytes = Number(body.bytes);
  if (!isSha256(body.sha256)) return NextResponse.json({ error: 'Missing fingerprint' }, { status: 400 });
  if (body.contentType !== DOCUMENT_CONTENT_TYPE) return NextResponse.json({ error: 'Documents must be PDFs.' }, { status: 400 });
  if (!Number.isFinite(bytes) || bytes <= 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
  if (bytes > DOCUMENT_MAX_BYTES) {
    return NextResponse.json({ error: `The file is over ${DOCUMENT_MAX_BYTES / (1024 * 1024)} MB.` }, { status: 400 });
  }

  const [match, allowance] = await Promise.all([fingerprintMatch(db, body.sha256), getAllowance(db)]);
  if (library ? match.library : match.own) {
    return NextResponse.json({ error: 'Bottega already has this file.', match }, { status: 409 });
  }
  if (!allowance) return NextResponse.json({ error: 'This account is awaiting approval.' }, { status: 403 });
  if (!storageAllows(allowance, bytes)) {
    return NextResponse.json(
      {
        error: `That would take you past your storage allowance (${formatBytes(allowance.storageUsed)} of ${formatBytes(allowance.storageBytes ?? 0)} used).`,
      },
      { status: 413 },
    );
  }

  const key = newDocumentKey(library ? null : userId);
  return NextResponse.json({ url: await signFileUpload(key, DOCUMENT_CONTENT_TYPE), key });
}

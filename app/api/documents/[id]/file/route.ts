import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { getDocument, getDocumentFile } from '@/lib/documents';
import { DOCUMENT_CONTENT_TYPE } from '@/lib/documentTypes';
import { signFileGet } from '@/lib/files';

export const dynamic = 'force-dynamic';

// GET /api/documents/:id/file — a 10-minute download link for anyone who can
// read the document, minted after the database has said they can.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const [doc, file] = await Promise.all([getDocument(account.db, id), getDocumentFile(account.db, id)]);
  if (!doc || !file) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const url = await signFileGet(file.key, { filename: file.filename, contentType: DOCUMENT_CONTENT_TYPE });
  return NextResponse.redirect(url, 302);
}

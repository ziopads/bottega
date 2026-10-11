import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import {
  deleteDocument,
  getDocument,
  reviewDocument,
  setPicked,
  updateDocument,
  type DocumentPatch,
} from '@/lib/documents';
import { DOCUMENT_KINDS, LIBRARY_KINDS, type DocumentKind, type ReviewStatus } from '@/lib/documentTypes';
import { deleteFile } from '@/lib/files';
import { levelAtLeast } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const NOT_FOUND = () => NextResponse.json({ error: 'Not found.' }, { status: 404 });

// GET /api/documents/:id
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const document = await getDocument(account.db, id);
  return document ? NextResponse.json({ document }) : NOT_FOUND();
}

// PATCH /api/documents/:id   { title?, manufacturer?, model?, kind?, reviewStatus?, picked? }
//   title, manufacturer, model, kind  edit access (the contributor while under review, the owner, an editor)
//   reviewStatus               the platform administrator only (K-6)
//   picked                     anyone who can read a library document, for their own search (K-7)
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const doc = await getDocument(db, id);
  if (!doc) return NOT_FOUND();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const patch: DocumentPatch = {};
  for (const field of ['title', 'manufacturer', 'model'] as const) {
    if (typeof body[field] === 'string') patch[field] = (body[field] as string).trim().slice(0, 300);
  }
  if (patch.title === '') return NextResponse.json({ error: 'A title is needed.' }, { status: 400 });
  if ((doc.library ? LIBRARY_KINDS : DOCUMENT_KINDS).includes(body.kind as DocumentKind)) patch.kind = body.kind as DocumentKind;
  if (Object.keys(patch).length) {
    if (!levelAtLeast(doc.level, 'edit')) return NextResponse.json({ error: 'That needs edit access.' }, { status: 403 });
    await updateDocument(db, id, patch);
  }

  if (body.reviewStatus !== undefined) {
    const status = body.reviewStatus as ReviewStatus;
    if (!['submitted', 'approved', 'rejected'].includes(status) || !doc.library) {
      return NextResponse.json({ error: 'Invalid review status' }, { status: 400 });
    }
    if (!account.isPlatformAdmin) {
      return NextResponse.json({ error: 'Only the platform administrator reviews library documents.' }, { status: 403 });
    }
    await reviewDocument(db, id, status);
  }

  if (typeof body.picked === 'boolean') {
    if (!doc.library) return NextResponse.json({ error: 'Only library documents are picked.' }, { status: 400 });
    await setPicked(db, id, body.picked);
  }

  return NextResponse.json({ document: await getDocument(db, id) });
}

// DELETE /api/documents/:id — the owner of a private document; the
// contributor of a library document not yet approved; the administrator.
// The database decides; the file is deleted only once the row is gone.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const doc = await getDocument(account.db, id);
  if (!doc) return NOT_FOUND();
  const key = await deleteDocument(account.db, id);
  if (!key) return NextResponse.json({ error: 'You cannot delete this document.' }, { status: 403 });
  try {
    await deleteFile(key);
  } catch (err) {
    // The row is gone; an orphaned object is found later by comparing keys (O-5).
    console.error('[documents] could not delete stored file', { id, err });
  }
  return NextResponse.json({ ok: true });
}

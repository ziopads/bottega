import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { getDocument, linkModel, unlinkModel } from '@/lib/documents';

export const dynamic = 'force-dynamic';

async function ids(ctx: { params: Promise<{ id: string }> }, req: Request): Promise<[number, number] | null> {
  const id = Number((await ctx.params).id);
  let modelId = Number(new URL(req.url).searchParams.get('modelId'));
  if (!modelId && req.method === 'POST') {
    try {
      modelId = Number(((await req.json()) as Record<string, unknown>).modelId);
    } catch {
      return null;
    }
  }
  return Number.isInteger(id) && id > 0 && Number.isInteger(modelId) && modelId > 0 ? [id, modelId] : null;
}

// POST /api/documents/:id/models   { modelId }
// Link a library manual to a catalogue model, so every unit of that model has
// it (REQUIREMENTS G-4, K-6). Anyone who can read the manual may link it.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const pair = await ids(ctx, req);
  if (!pair) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const doc = await getDocument(account.db, pair[0]);
  if (!doc) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!doc.library) return NextResponse.json({ error: 'Only library manuals are linked to models.' }, { status: 400 });
  if (!(await linkModel(account.db, pair[0], pair[1]))) {
    return NextResponse.json({ error: 'That model is not in the catalogue.' }, { status: 400 });
  }
  return NextResponse.json({ document: await getDocument(account.db, pair[0]) });
}

// DELETE /api/documents/:id/models?modelId= — the administrator, or whoever made the link.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const pair = await ids(ctx, req);
  if (!pair) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!(await unlinkModel(account.db, pair[0], pair[1]))) {
    return NextResponse.json({ error: 'Only the administrator or whoever linked them can remove that link.' }, { status: 403 });
  }
  return NextResponse.json({ document: await getDocument(account.db, pair[0]) });
}

import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { readFolderInput } from '@/lib/als/input';
import { saveFolder } from '@/lib/als/store';

export const dynamic = 'force-dynamic';

// PUT /api/projects/:id/folder   { folderName, files: [{ path, bytes }] }
// The session's project folder as last read: names and sizes only, no audio
// (REQUIREMENTS A-6, A-7; db/014).
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(account.db, id, 'edit');
  if (refusal) return refusal;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const input = readFolderInput(body);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 });
  await saveFolder(account.db, id, input.folderName, input.files);
  return NextResponse.json({ ok: true });
}

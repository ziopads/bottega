import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { saveFolder } from '@/lib/als/store';
import type { FolderFile } from '@/lib/als/types';

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
  const folderName = typeof body.folderName === 'string' ? body.folderName.slice(0, 255) : '';
  if (!Array.isArray(body.files) || body.files.length > 50000) {
    return NextResponse.json({ error: 'The folder listing is missing or too long.' }, { status: 400 });
  }
  const files: FolderFile[] = [];
  for (const f of body.files as unknown[]) {
    const x = f as FolderFile;
    if (typeof x?.path !== 'string' || !x.path || x.path.length > 1024 || !(Number(x.bytes) >= 0)) {
      return NextResponse.json({ error: 'A file in the listing is malformed.' }, { status: 400 });
    }
    files.push({ path: x.path, bytes: Number(x.bytes) });
  }
  await saveFolder(account.db, id, folderName, files);
  return NextResponse.json({ ok: true });
}

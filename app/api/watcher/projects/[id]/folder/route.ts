import { NextResponse } from 'next/server';

import { projectRefusal } from '@/lib/access';
import { readFolderInput } from '@/lib/als/input';
import { saveFolder } from '@/lib/als/store';
import { tokenAccount } from '@/lib/tokens';
import { bad, parseId } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// PUT /api/watcher/projects/:id/folder   { folderName, files: [{ path, bytes }] }
// The project folder as the Mac watcher last read it: names and sizes only
// (REQUIREMENTS A-7, A-9).
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await tokenAccount(req);
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const refusal = await projectRefusal(account.db, id, 'edit');
  if (refusal) return refusal;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad('Invalid body');
  }
  const input = readFolderInput(body);
  if ('error' in input) return bad(input.error);
  await saveFolder(account.db, id, input.folderName, input.files);
  return NextResponse.json({ ok: true });
}

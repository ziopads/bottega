import { NextResponse } from 'next/server';

import { listProjects } from '@/lib/studio';
import { tokenAccount } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

// The Mac watcher (REQUIREMENTS A-9, db/026), signed in with a personal access
// token: the projects it may send sets to (the person's own and those shared
// with them to edit), with what it needs to find each one's folder.

// GET /api/watcher/projects
export async function GET(req: Request) {
  const account = await tokenAccount(req);
  if (account instanceof NextResponse) return account;
  const [projects, folders] = await Promise.all([
    listProjects(account.db),
    account.db.q('select project_id, folder_name from project_folders'),
  ]);
  const folderOf = new Map(folders.map((r) => [Number(r.project_id), String(r.folder_name)]));
  return NextResponse.json({
    projects: projects
      .filter((p) => p.level === 'owner' || p.level === 'edit')
      .map((p) => ({ id: p.id, canonicalId: p.canonicalId, title: p.workingName, folderName: folderOf.get(p.id) ?? null })),
  });
}

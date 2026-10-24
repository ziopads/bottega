import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { listSnapshotMeta } from '@/lib/als/store';
import { listWorkSessions } from '@/lib/sessions';
import { bad, parseId } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// GET /api/projects/:id/sessions → { sessions, saves }
// The project's work sessions read from its saved sets, newest first, the
// newest with what changed (REQUIREMENTS W-40), and its latest saves, for the
// working panel's feed as the watcher sends each save.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const refusal = await projectRefusal(account.db, id, 'view');
  if (refusal) return refusal;
  const [sessions, saves] = await Promise.all([listWorkSessions(account.db, id, 5, 1), listSnapshotMeta(account.db, id)]);
  return NextResponse.json(
    { sessions, saves: saves.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, 10) },
    { headers: { 'cache-control': 'no-store' } },
  );
}

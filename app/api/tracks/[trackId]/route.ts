import { NextResponse } from 'next/server';
import { apiAccount, projectRefusal } from '@/lib/access';
import { deleteTrackRow, getTrackWithKey } from '@/lib/studio';
import { deleteAudio } from '@/lib/studioAudio';

export const dynamic = 'force-dynamic';

// DELETE /api/tracks/:trackId
// The project's owner only (REQUIREMENTS AC-7). Collaborators can add versions
// but not remove them. Notes that pointed at the
// track keep their text and lose the pointer (ON DELETE SET NULL). The next
// upload takes the highest remaining version + 1, so deleting the newest
// version frees its number for reuse.
export async function DELETE(_req: Request, ctx: { params: Promise<{ trackId: string }> }) {
  const params = await ctx.params;
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;

  const id = Number(params.trackId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const found = await getTrackWithKey(db, id);
  if (!found) return NextResponse.json({ error: 'Track not found' }, { status: 404 });
  const refusal = await projectRefusal(db, found.track.projectId, 'owner');
  if (refusal) return refusal;

  await deleteTrackRow(db, id);
  // Row first, then the object: a failed object delete leaves an orphan in the
  // bucket (harmless, costs pennies), never a row pointing at nothing.
  try {
    await deleteAudio(found.key);
  } catch (err) {
    console.error('studio audio delete failed', found.key, err);
  }
  return NextResponse.json({ ok: true });
}

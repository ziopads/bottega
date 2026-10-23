import BoardView from '@/app/_board/BoardView';
import { requireAccount } from '@/lib/access';
import { getBoard } from '@/lib/board';

// The board, the home page (REQUIREMENTS W-21 to W-23): the person's own
// projects in the backlog, in rotation, and finished. The projects list is at
// /projects.

export const metadata = { title: 'Board · Bottega' };

export default async function BoardPage() {
  const { db, userId } = await requireAccount();
  const board = await getBoard(db, userId);
  return <BoardView initial={board} />;
}

import BoardView from '@/app/_board/BoardView';
import { requireAccount } from '@/lib/access';
import { getBoard } from '@/lib/board';
import { getAccountMethod } from '@/lib/templates';

// The board, the home page (REQUIREMENTS W-21 to W-23): the person's own
// projects in the backlog and in rotation, and at the foot the method of the
// template new projects start from (W-42). The projects list is at /projects.

export const metadata = { title: 'Board · Bottega' };

export default async function BoardPage() {
  const { db, userId } = await requireAccount();
  const [board, method] = await Promise.all([getBoard(db, userId), getAccountMethod(db)]);
  return <BoardView initial={board} method={method} />;
}

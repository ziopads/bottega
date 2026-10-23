import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { BoardError, getBoard, placeOnBoard, swapOnBoard, takeOffBoard } from '@/lib/board';
import { bad, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// The person's own board (REQUIREMENTS W-21, W-22; db/024). Every change
// answers with the whole board.

// GET /api/board
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  return NextResponse.json({ board: await getBoard(account.db, account.userId) });
}

const id = (raw: unknown): number | null => (Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : null);

// POST /api/board   { op: 'place', projectId, place: 'backlog' | 'rotation' }
//                 | { op: 'swap', inId, outId } | { op: 'remove', projectId }
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db, userId } = account;
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  try {
    if (body.op === 'place') {
      const p = id(body.projectId);
      if (!p || (body.place !== 'backlog' && body.place !== 'rotation')) return bad('Name a project and a place');
      await placeOnBoard(db, p, body.place);
    } else if (body.op === 'swap') {
      const a = id(body.inId);
      const b = id(body.outId);
      if (!a || !b) return bad('Name the two projects');
      await swapOnBoard(db, a, b);
    } else if (body.op === 'remove') {
      const p = id(body.projectId);
      if (!p) return bad('Name a project');
      await takeOffBoard(db, p);
    } else {
      return bad('Unknown operation');
    }
  } catch (err) {
    if (err instanceof BoardError) return bad(err.message);
    throw err;
  }
  return NextResponse.json({ board: await getBoard(db, userId) });
}

import { NextResponse } from 'next/server';
import { apiAccount, projectRefusal, type Level } from '@/lib/access';
import type { Scoped } from '@/lib/db';
import { addToRelease, releaseProjects, removeFromRelease, reorderRelease } from '@/lib/studio';

export const dynamic = 'force-dynamic';

// The running order of a collection.
//   POST   { projectIds }  append sessions (ones already on it are skipped); edit access
//   PUT    { projectIds }  set the order, first to last; edit access
//   DELETE { projectId }   take one off and close the gap; the owner only (AC-7)
// Each answers with the new running order. A session can be added only if the
// person can see it; the database refuses the rest.

async function setup(
  req: Request,
  rawId: string,
  minimum: Level,
): Promise<{ error: NextResponse } | { id: number; body: Record<string, unknown>; db: Scoped }> {
  const account = await apiAccount();
  if (account instanceof NextResponse) return { error: account };
  const { db } = account;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: NextResponse.json({ error: 'Collection not found' }, { status: 404 }) };
  }
  const refusal = await projectRefusal(db, id, minimum);
  if (refusal) return { error: refusal };
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return { error: NextResponse.json({ error: 'Invalid body' }, { status: 400 }) };
  }
  return { id, body, db };
}

function ids(v: unknown): number[] {
  return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const s = await setup(req, params.id, 'edit');
  if ('error' in s) return s.error;
  await addToRelease(s.db, s.id, ids(s.body.projectIds));
  return NextResponse.json({ projects: await releaseProjects(s.db, s.id) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const s = await setup(req, params.id, 'edit');
  if ('error' in s) return s.error;
  await reorderRelease(s.db, s.id, ids(s.body.projectIds));
  return NextResponse.json({ projects: await releaseProjects(s.db, s.id) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const s = await setup(req, params.id, 'owner');
  if ('error' in s) return s.error;
  const projectId = Number(s.body.projectId);
  if (!Number.isInteger(projectId)) return NextResponse.json({ error: 'Invalid project' }, { status: 400 });
  await removeFromRelease(s.db, s.id, projectId);
  return NextResponse.json({ projects: await releaseProjects(s.db, s.id) });
}

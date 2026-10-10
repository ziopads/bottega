import { NextResponse } from 'next/server';
import { addToRelease, getRelease, getStudioViewer, releaseProjects, removeFromRelease, reorderRelease } from '@/lib/studio';

export const dynamic = 'force-dynamic';

// The running order of a release.
//   POST   { projectIds }  append sessions (ones already on it are skipped)
//   PUT    { projectIds }  set the order, first to last
//   DELETE { projectId }   take one off and close the gap
// Each answers with the new running order.

async function setup(req: Request, rawId: string) {
  const viewer = await getStudioViewer();
  if (!viewer) return { error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || !(await getRelease(id))) {
    return { error: NextResponse.json({ error: 'Collection not found' }, { status: 404 }) };
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return { error: NextResponse.json({ error: 'Invalid body' }, { status: 400 }) };
  }
  return { id, body };
}

function ids(v: unknown): number[] {
  return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const s = await setup(req, params.id);
  if ('error' in s) return s.error;
  await addToRelease(s.id, ids(s.body.projectIds));
  return NextResponse.json({ projects: await releaseProjects(s.id) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const s = await setup(req, params.id);
  if ('error' in s) return s.error;
  await reorderRelease(s.id, ids(s.body.projectIds));
  return NextResponse.json({ projects: await releaseProjects(s.id) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const s = await setup(req, params.id);
  if ('error' in s) return s.error;
  const projectId = Number(s.body.projectId);
  if (!Number.isInteger(projectId)) return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
  await removeFromRelease(s.id, projectId);
  return NextResponse.json({ projects: await releaseProjects(s.id) });
}

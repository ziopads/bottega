import { NextResponse } from 'next/server';
import { addNote, getProject, getStudioViewer, listNotes } from '@/lib/studio';
import { parseNoteBody } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/projects/:id/notes — newest first.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  return NextResponse.json({ notes: await listNotes(id) });
}

// POST /api/projects/:id/notes   { body, trackId? }
// Any studio member. trackId ties the note to one version of the mix; omit or
// null for a note about the project as a whole.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const text = parseNoteBody(body.body);
  if ('error' in text) return NextResponse.json({ error: text.error }, { status: 400 });
  let trackId: number | null = null;
  if (body.trackId !== undefined && body.trackId !== null && body.trackId !== '') {
    trackId = parseId(String(body.trackId));
    if (!trackId) return NextResponse.json({ error: 'Invalid track' }, { status: 400 });
  }

  if (!(await getProject(id))) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const result = await addNote({ projectId: id, trackId, body: text.value, by: viewer.email });
  if (!result.ok) return NextResponse.json({ error: 'That version is not part of this project.' }, { status: 400 });
  return NextResponse.json({ note: result.note }, { status: 201 });
}

import { NextResponse } from 'next/server';
import { apiAccount, projectRefusal } from '@/lib/access';
import { deleteNote, getNote, updateNote } from '@/lib/studio';
import { parseNoteBody } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// PATCH /api/notes/:noteId   { body?, trackId? }
// The author only: a note is someone's own words, so nobody else rewrites it.
export async function PATCH(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const params = await ctx.params;
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId(params.noteId);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const note = await getNote(db, id);
  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  if (note.authorId !== account.userId) return NextResponse.json({ error: 'Only the author can edit a note.' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const patch: { body?: string; trackId?: number | null } = {};
  if ('body' in body) {
    const text = parseNoteBody(body.body);
    if ('error' in text) return NextResponse.json({ error: text.error }, { status: 400 });
    patch.body = text.value;
  }
  if ('trackId' in body) {
    if (body.trackId === null || body.trackId === '') patch.trackId = null;
    else {
      const t = parseId(String(body.trackId));
      if (!t) return NextResponse.json({ error: 'Invalid track' }, { status: 400 });
      patch.trackId = t;
    }
  }
  const result = await updateNote(db, id, patch);
  if (!result.ok) {
    return result.reason === 'not-found'
      ? NextResponse.json({ error: 'Note not found' }, { status: 404 })
      : NextResponse.json({ error: 'That version is not part of this project.' }, { status: 400 });
  }
  return NextResponse.json({ note: result.note });
}

// DELETE /api/notes/:noteId — the project's owner only (REQUIREMENTS AC-7),
// including notes collaborators wrote.
export async function DELETE(_req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const params = await ctx.params;
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId(params.noteId);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const note = await getNote(db, id);
  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  const refusal = await projectRefusal(db, note.projectId, 'owner');
  if (refusal) return refusal;
  await deleteNote(db, id);
  return NextResponse.json({ ok: true });
}

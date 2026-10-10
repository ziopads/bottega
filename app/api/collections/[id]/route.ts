import { NextResponse } from 'next/server';
import { deleteRelease, getRelease, getStudioViewer, releaseProjects, updateRelease } from '@/lib/studio';
import { RELEASE_KINDS, parseReleaseTitle, type ReleaseKind } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/collections/:id — the release and its sessions in running order.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const release = await getRelease(id);
  if (!release) return NextResponse.json({ error: 'Release not found' }, { status: 404 });
  return NextResponse.json({ release, projects: await releaseProjects(id) });
}

// PATCH /api/collections/:id   { title?, kind?, artistId?, year?, notes? }
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
  const patch: { title?: string; kind?: ReleaseKind; artistId?: number | null; year?: number | null; notes?: string } = {};
  if ('title' in body) {
    const t = parseReleaseTitle(body.title);
    if ('error' in t) return NextResponse.json({ error: t.error }, { status: 400 });
    patch.title = t.value;
  }
  if ('kind' in body) {
    if (!RELEASE_KINDS.includes(body.kind as ReleaseKind)) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    patch.kind = body.kind as ReleaseKind;
  }
  if ('artistId' in body) {
    const a = body.artistId === null || body.artistId === '' ? null : Number(body.artistId);
    if (a !== null && !Number.isInteger(a)) return NextResponse.json({ error: 'Invalid artist' }, { status: 400 });
    patch.artistId = a;
  }
  if ('year' in body) {
    const y = body.year === null || body.year === '' ? null : Number(body.year);
    if (y !== null && (!Number.isInteger(y) || y < 1900 || y > 2200)) {
      return NextResponse.json({ error: 'Year must be a four-digit year.' }, { status: 400 });
    }
    patch.year = y;
  }
  if ('notes' in body) {
    if (typeof body.notes !== 'string') return NextResponse.json({ error: 'Invalid notes' }, { status: 400 });
    patch.notes = body.notes.slice(0, 10_000);
  }
  const release = await updateRelease(id, patch);
  if (!release) return NextResponse.json({ error: 'Release not found' }, { status: 404 });
  return NextResponse.json({ release });
}

// DELETE /api/collections/:id — removes the grouping only; sessions and audio stay.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const viewer = await getStudioViewer();
  if (!viewer) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  await deleteRelease(id);
  return NextResponse.json({ ok: true });
}

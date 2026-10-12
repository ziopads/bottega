import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { getSessionState, listSnapshotMeta, looksLikeSet, saveSnapshot } from '@/lib/als/store';

export const dynamic = 'force-dynamic';

// A session's saved Live sets, as read by the parser (REQUIREMENTS A-6, db/014).

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/projects/:id/als            the saves already stored (fingerprints, parser version)
// GET /api/projects/:id/als?state=1[&variant=Radio edit][&save=ID]
//                                      the State tab's data for a variant, at a save
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(account.db, id, 'view');
  if (refusal) return refusal;
  const q = new URL(req.url).searchParams;
  if (q.get('state')) {
    const save = Number(q.get('save'));
    const state = await getSessionState(account.db, id, {
      variant: (q.get('variant') ?? '').trim(),
      saveId: Number.isInteger(save) && save > 0 ? save : null,
    });
    return NextResponse.json({ state });
  }
  return NextResponse.json({ snapshots: await listSnapshotMeta(account.db, id) });
}

// POST /api/projects/:id/als   { fileName, savedAt, sha256, bytes, set }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(account.db, id, 'edit');
  if (refusal) return refusal;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 255) : '';
  const savedAt = typeof body.savedAt === 'string' && !Number.isNaN(Date.parse(body.savedAt)) ? body.savedAt : '';
  const sha256 = typeof body.sha256 === 'string' && /^[0-9a-f]{64}$/.test(body.sha256) ? body.sha256 : '';
  const bytes = Number(body.bytes);
  if (!fileName.endsWith('.als') || !savedAt || !sha256 || !(bytes > 0)) {
    return NextResponse.json({ error: 'A set needs its file name, save time, fingerprint and size.' }, { status: 400 });
  }
  if (!looksLikeSet(body.set)) return NextResponse.json({ error: 'That is not a set this parser wrote.' }, { status: 400 });
  const result = await saveSnapshot(account.db, id, { fileName, savedAt, sha256, bytes, set: body.set });
  return NextResponse.json({ result });
}

import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { ArtistError, listArtistSettings, setArtistTemplates } from '@/lib/artists';
import { addShare, deleteShare, updateShare } from '@/lib/studio';
import { parseOptionalId } from '@/lib/workflowInput';
import { bad, parseId, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// An artist's templates and sharing (REQUIREMENTS W-30 to W-32, db/028).
//
// POST /api/artists/:id/settings
//   { op: 'templates', workflowTemplateId, structureTemplateId }   anyone with edit on the artist
//   { op: 'share', email, level: 'view' | 'edit' }                  the artist's account
//   { op: 'share-level', shareId, level } | { op: 'unshare', shareId }
// Answers with every artist's settings. The database decides who may do
// what, and logs each share.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return bad('Invalid id');
  const body = await readBody(req);
  if (!body) return bad('Invalid body');
  const level = body.level === 'edit' ? 'edit' : body.level === 'view' ? 'view' : null;

  try {
    if (body.op === 'templates') {
      const w = parseOptionalId(body.workflowTemplateId ?? null);
      if ('error' in w) return bad(w.error);
      const s = parseOptionalId(body.structureTemplateId ?? null);
      if ('error' in s) return bad(s.error);
      await setArtistTemplates(db, id, w.value, s.value);
    } else if (body.op === 'share') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email.includes('@')) return bad('Enter an email address.');
      if (!level) return bad('Choose view or edit.');
      const result = await addShare(db, { kind: 'artist', id }, email, level);
      if (!result.ok) {
        return bad(
          {
            'no-account': 'No active Bottega account has that email. They need to sign up and be approved first.',
            self: 'That is your own account.',
            exists: 'Already shared with that person. Change the level in the list instead.',
          }[result.reason],
        );
      }
    } else if (body.op === 'share-level') {
      const shareId = parseId(String(body.shareId ?? ''));
      if (!shareId || !level) return bad('Name a share and a level.');
      await updateShare(db, shareId, level);
    } else if (body.op === 'unshare') {
      const shareId = parseId(String(body.shareId ?? ''));
      if (!shareId) return bad('Name a share.');
      await deleteShare(db, shareId);
    } else {
      return bad('Unknown operation');
    }
  } catch (err) {
    if (err instanceof ArtistError) return bad(err.message);
    const msg = (err as { message?: string })?.message ?? '';
    if (/row-level security|shared to view or to edit/.test(msg)) return bad('Only the artist’s account can change who it is shared with.');
    throw err;
  }
  return NextResponse.json(await listArtistSettings(db));
}

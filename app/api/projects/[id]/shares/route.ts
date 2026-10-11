import { NextResponse } from 'next/server';

import { apiAccount, projectRefusal } from '@/lib/access';
import { addShare, listShares } from '@/lib/studio';
import { SHARE_LEVELS, type ShareLevel } from '@/lib/studioTypes';

export const dynamic = 'force-dynamic';

// Who a project is shared with (REQUIREMENTS AC-5). The owner only, for both
// reading and granting. Each grant is written to the access log by the
// database.

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/projects/:id/shares
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(db, id, 'owner');
  if (refusal) return refusal;
  return NextResponse.json({ shares: await listShares(db, { kind: 'project', id }) });
}

// POST /api/projects/:id/shares   { email, level }
// Shares with the active account that has this email. The answer is the same
// "no active account" for an unknown address and a pending one.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await projectRefusal(db, id, 'owner');
  if (refusal) return refusal;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'Enter an email address.' }, { status: 400 });
  const level = body.level as ShareLevel;
  if (!SHARE_LEVELS.includes(level)) return NextResponse.json({ error: 'Choose view, contribute or edit.' }, { status: 400 });

  const result = await addShare(db, { kind: 'project', id }, email, level);
  if (!result.ok) {
    const message = {
      'no-account': 'No active Bottega account has that email. They need to sign up and be approved first.',
      self: 'That is your own account.',
      exists: 'Already shared with that person. Change the level in the list instead.',
    }[result.reason];
    return NextResponse.json({ error: message }, { status: result.reason === 'exists' ? 409 : 400 });
  }
  return NextResponse.json({ share: result.share }, { status: 201 });
}

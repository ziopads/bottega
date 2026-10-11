import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import { getModel, isCapabilityRefusal, listCapabilityDefs, setModelCapability } from '@/lib/gear';
import { parseCapabilityValue } from '@/lib/gearTypes';

export const dynamic = 'force-dynamic';

// PUT /api/gear-models/:id/capabilities   { key, value }   value null clears it
// A model's capabilities, shared by every unit of it (REQUIREMENTS G-3). The
// platform administrator only; the database refuses anyone else.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  if (!account.isPlatformAdmin) return NextResponse.json({ error: 'Only the platform administrator edits the catalogue.' }, { status: 403 });
  const { db } = account;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0 || !(await getModel(db, id))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const def = (await listCapabilityDefs(db)).find((d) => d.key === body.key);
  if (!def) return NextResponse.json({ error: 'Unknown capability' }, { status: 400 });
  let value = null;
  if (body.value !== null) {
    const parsed = parseCapabilityValue(def, body.value);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    value = parsed.value;
  }
  try {
    await setModelCapability(db, id, def.key, value);
  } catch (err) {
    if (isCapabilityRefusal(err)) return NextResponse.json({ error: `${def.label}: not a valid value.` }, { status: 400 });
    throw err;
  }
  return NextResponse.json({ model: await getModel(db, id) });
}

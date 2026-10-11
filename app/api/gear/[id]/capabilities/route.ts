import { NextResponse } from 'next/server';

import { apiAccount, gearRefusal } from '@/lib/access';
import { getGear, isCapabilityRefusal, listCapabilityDefs, setGearCapability } from '@/lib/gear';
import { parseCapabilityValue } from '@/lib/gearTypes';

export const dynamic = 'force-dynamic';

// PUT /api/gear/:id/capabilities   { key, value }   value null clears the override
// Where this unit differs from its model (REQUIREMENTS G-3). Edit access or above.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const refusal = await gearRefusal(db, id, 'edit');
  if (refusal) return refusal;

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
    await setGearCapability(db, id, def.key, value);
  } catch (err) {
    if (isCapabilityRefusal(err)) return NextResponse.json({ error: `${def.label}: not a valid value.` }, { status: 400 });
    throw err;
  }
  return NextResponse.json({ unit: await getGear(db, id) });
}

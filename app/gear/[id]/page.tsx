import Link from 'next/link';
import { notFound } from 'next/navigation';

import GearDetail from '@/app/_gear/GearDetail';
import { requireAccount } from '@/lib/access';
import { filesConfigured } from '@/lib/files';
import { getGear, getGearPrivate, listCapabilityDefs, listGearFiles } from '@/lib/gear';
import { unitTitle } from '@/lib/gearTypes';
import { listShares } from '@/lib/studio';

// One gear unit, as the signed-in person may see it. The insurance record and
// the shares are fetched only for its owner; the database would return
// nothing to anyone else in any case.

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Params) {
  const { db } = await requireAccount();
  const id = parseId((await params).id);
  const unit = id ? await getGear(db, id).catch(() => null) : null;
  return { title: unit ? `${unitTitle(unit)} · Bottega` : 'Gear · Bottega' };
}

export default async function GearUnitPage({ params }: Params) {
  const { db } = await requireAccount();
  const id = parseId((await params).id);
  if (!id) notFound();
  const unit = await getGear(db, id);
  if (!unit) notFound();
  const isOwner = unit.level === 'owner';

  const [defs, files, record, shares] = await Promise.all([
    listCapabilityDefs(db),
    listGearFiles(db, id),
    isOwner ? getGearPrivate(db, id) : Promise.resolve(null),
    isOwner ? listShares(db, { kind: 'gear', id }) : Promise.resolve([]),
  ]);

  return (
    <div>
      <Link href="/gear" className="text-sm text-muted hover:text-rust">
        ← Gear
      </Link>
      <GearDetail
        initialUnit={unit}
        defs={defs}
        initialFiles={files}
        initialRecord={record}
        initialShares={shares}
        uploadsEnabled={filesConfigured()}
      />
    </div>
  );
}

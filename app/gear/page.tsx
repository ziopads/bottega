import GearList from '@/app/_gear/GearList';
import { requireAccount } from '@/lib/access';
import { listCapabilityDefs, listGear } from '@/lib/gear';

// Gear, the signed-in person's own units first, then units shared with them
// (REQUIREMENTS AC-8, §4).

export const metadata = { title: 'Gear · Bottega' };

export default async function GearPage() {
  const { db, userId } = await requireAccount();
  const [units, defs] = await Promise.all([listGear(db), listCapabilityDefs(db)]);
  return (
    <div>
      <h1 className="mb-6 font-serif text-2xl sm:text-3xl">Gear</h1>
      <GearList initialUnits={units} defs={defs} viewerId={userId} />
    </div>
  );
}

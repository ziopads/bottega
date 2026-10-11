import Link from 'next/link';

import GearList from '@/app/_gear/GearList';
import GearMap from '@/app/_gear/GearMap';
import { requireAccount } from '@/lib/access';
import { listCapabilityDefs, listGear } from '@/lib/gear';

// Gear, in two views (REQUIREMENTS G-11): the map, the studio laid out by
// group, and the list, filterable by status, group and capability, with
// photos and the form to add a unit. The viewer's own units first, then
// units shared with them (AC-8).

export const metadata = { title: 'Gear · Bottega' };

const VIEWS = [
  { key: 'map', label: 'Map' },
  { key: 'list', label: 'List' },
] as const;

export default async function GearPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { db, userId } = await requireAccount();
  const view = (await searchParams).view === 'list' ? 'list' : 'map';
  const [units, defs] = await Promise.all([listGear(db), view === 'list' ? listCapabilityDefs(db) : Promise.resolve([])]);
  return (
    <div>
      <div className="mb-4 flex items-end gap-6 border-b border-line">
        <h1 className="pb-2 font-serif text-2xl">Gear</h1>
        <nav className="flex text-sm" aria-label="Gear views">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={v.key === 'map' ? '/gear' : `/gear?view=${v.key}`}
              aria-current={view === v.key ? 'page' : undefined}
              className={`-mb-px border px-3 py-1.5 ${
                view === v.key ? 'border-line border-b-parchment bg-parchment text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </div>
      {view === 'map' ? <GearMap units={units} viewerId={userId} /> : <GearList initialUnits={units} defs={defs} viewerId={userId} />}
    </div>
  );
}

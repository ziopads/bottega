'use client';

import Link from 'next/link';
import { useState } from 'react';

import { GEAR_GROUPS, groupOf, type GearGroup } from '@/lib/gearGroups';
import type { GearUnit } from '@/lib/gearTypes';

// The gear map (REQUIREMENTS G-11): one column per studio group, each unit
// listed beneath it on a branch, owned first and the wishlist after a
// dashed rule. Text only and dense, so the whole room reads at a glance;
// photos and capabilities are in the List view and on each unit's page.
// Groups with nothing in them are left out. Gone units are not shown.

function byName(a: GearUnit, b: GearUnit): number {
  const ka = `${a.model?.manufacturer ?? a.manufacturer} ${a.model?.model ?? a.name}`.toLowerCase();
  const kb = `${b.model?.manufacturer ?? b.manufacturer} ${b.model?.model ?? b.name}`.toLowerCase();
  return ka.localeCompare(kb);
}

function Branch({ u, wish }: { u: GearUnit; wish?: boolean }) {
  const manufacturer = u.model?.manufacturer ?? u.manufacturer;
  const model = u.model?.model ?? u.name;
  return (
    <li
      className={`relative pl-3 before:absolute before:left-0 before:top-[0.6rem] before:w-2 before:border-t ${
        wish ? 'before:border-dashed before:border-line' : 'before:border-ink/30'
      }`}
    >
      <Link
        href={`/gear/${u.id}`}
        className={`block truncate leading-5 hover:text-rust hover:underline ${wish ? 'text-muted' : ''}`}
        title={[manufacturer, model, u.nickname && `“${u.nickname}”`].filter(Boolean).join(' ')}
      >
        <span className="text-muted">{manufacturer}</span> {model}
        {u.nickname && <span className="text-muted"> · {u.nickname}</span>}
      </Link>
    </li>
  );
}

// A long group is split by catalogue category ("synthesizers 23", "drum
// machines 5") so it scans in sections; a short one is a single list.
const SPLIT_OVER = 15;
function sections(units: GearUnit[]): [string, GearUnit[]][] {
  if (units.length <= SPLIT_OVER) return [['', units]];
  const by = new Map<string, GearUnit[]>();
  for (const u of units) {
    const c = u.model?.category ?? 'other';
    by.set(c, [...(by.get(c) ?? []), u]);
  }
  if (by.size < 2) return [['', units]];
  return [...by.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([c, list]) => [`${c === 'other' ? 'other' : c.endsWith('s') ? c : `${c}s`} ${list.length}`, list]);
}

export default function GearMap({ units, viewerId }: { units: GearUnit[]; viewerId: string }) {
  const [showWishlist, setShowWishlist] = useState(true);
  const own = units.filter((u) => u.ownerId === viewerId && u.status !== 'gone');
  const shared = units.filter((u) => u.ownerId !== viewerId && u.status !== 'gone');

  const groups = new Map<GearGroup, { owned: GearUnit[]; wish: GearUnit[] }>();
  for (const u of own) {
    const g = groupOf(u);
    const bucket = groups.get(g) ?? { owned: [], wish: [] };
    (u.status === 'wishlist' ? bucket.wish : bucket.owned).push(u);
    groups.set(g, bucket);
  }
  const shown = GEAR_GROUPS.filter((g) => {
    const b = groups.get(g.key);
    return b && (b.owned.length || (showWishlist && b.wish.length));
  });
  const owned = own.filter((u) => u.status === 'owned').length;
  const wished = own.length - owned;

  return (
    <div className="text-[13px]">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line pb-3 text-muted">
        <span>
          {owned} owned · {wished} on the wishlist · {shown.length} groups
        </span>
        <label className="ml-auto flex items-center gap-1.5">
          <input type="checkbox" checked={showWishlist} onChange={(e) => setShowWishlist(e.target.checked)} />
          Show wishlist
        </label>
      </div>

      {own.length === 0 ? (
        <p className="py-6 text-muted">No gear yet. Add your first piece from the List view.</p>
      ) : (
        <div className="grid gap-x-4 gap-y-8 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
          {shown.map((g) => {
            const b = groups.get(g.key)!;
            const owned = [...b.owned].sort(byName);
            const wish = showWishlist ? [...b.wish].sort(byName) : [];
            return (
              <section key={g.key} className="min-w-0">
                <header className="border border-line px-2 py-1.5 leading-tight" title={g.note}>
                  <h2 className="text-[13px] font-medium">{g.label}</h2>
                  <p className="text-[11px] text-muted">
                    {b.owned.length} owned{b.wish.length ? ` · ${b.wish.length} wished` : ''}
                  </p>
                </header>
                <div className="ml-3 border-l border-ink/30 pt-1">
                  {sections(owned).map(([label, list]) => (
                    <div key={label || 'all'}>
                      {label && <p className="mt-1 pl-3 text-[11px] text-muted">{label}</p>}
                      <ul>
                        {list.map((u) => (
                          <Branch key={u.id} u={u} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {wish.length > 0 && (
                  <div className="ml-3 border-l border-dashed border-line pt-1">
                    <p className="pl-3 text-[11px] uppercase tracking-wide text-muted">wishlist</p>
                    <ul>
                      {wish.map((u) => (
                        <Branch key={u.id} u={u} wish />
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {shared.length > 0 && (
        <section className="mt-10 border-t border-line pt-3">
          <h2 className="mb-1 text-[11px] uppercase tracking-wide text-muted">Shared with me</h2>
          <ul className="columns-2 gap-x-6 sm:columns-3 lg:columns-4">
            {[...shared].sort(byName).map((u) => (
              <li key={u.id} className="truncate leading-5">
                <Link href={`/gear/${u.id}`} className="hover:text-rust hover:underline">
                  <span className="text-muted">{u.model?.manufacturer ?? u.manufacturer}</span> {u.model?.model ?? u.name}
                </Link>
                <span className="text-muted"> · {u.ownerName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

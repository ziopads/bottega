'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { api } from '@/app/_studio/controls';
import type { CapabilityDef, CapabilityValue, GearModel, GearStatus, GearUnit } from '@/lib/gearTypes';
import {
  GEAR_CATEGORIES,
  GEAR_KINDS,
  GEAR_STATUS_LABEL,
  GEAR_STATUSES,
  formatCapability,
  type GearCategory,
  type GearKind,
} from '@/lib/gearTypes';
import { GEAR_GROUPS, groupLabel, groupOf, type GearGroup } from '@/lib/gearGroups';
import { CapabilityInput } from './CapabilityEditor';
import RotatedImage from './RotatedImage';
import { BUTTON, BUTTON_PRIMARY } from '@/app/_ui/styles';

// The viewer's gear: their own units by status, with a filter by capability
// ("which of my sound sources can hold a non-equal-tempered scale?" is: sound
// sources only, Microtuning = yes), a form to add a unit from the catalogue
// or by name, and below, units others have shared with them (REQUIREMENTS
// AC-8, G-1, G-3, G-5).

const SUMMARY_KEYS = ['polyphony', 'synthesis', 'microtuning', 'form_factor'];

function matches(def: CapabilityDef, have: CapabilityValue | undefined, want: CapabilityValue): boolean {
  if (have === undefined) return false;
  switch (def.valueType) {
    case 'boolean':
    case 'enum':
      return have === want;
    case 'integer':
    case 'number':
      return typeof have === 'number' && typeof want === 'number' && have >= want;
    case 'text':
      return typeof have === 'string' && typeof want === 'string' && have.toLowerCase().includes(want.toLowerCase());
    case 'list':
      return Array.isArray(have) && Array.isArray(want) && want.every((w) => have.includes(w));
  }
}

export default function GearList({
  initialUnits,
  defs,
  viewerId,
}: {
  initialUnits: GearUnit[];
  defs: CapabilityDef[];
  viewerId: string;
}) {
  const [units, setUnits] = useState(initialUnits);
  const [status, setStatus] = useState<GearStatus>('owned');
  const [group, setGroup] = useState<GearGroup | ''>('');
  const [capKey, setCapKey] = useState('');
  const [capValue, setCapValue] = useState<CapabilityValue | undefined>(undefined);
  const [adding, setAdding] = useState(false);

  const defByKey = useMemo(() => new Map(defs.map((d) => [d.key, d])), [defs]);
  const capDef = capKey ? defByKey.get(capKey) : undefined;

  const own = units.filter((u) => u.ownerId === viewerId);
  const shared = units.filter((u) => u.ownerId !== viewerId);
  const shown = own.filter((u) => {
    if (u.status !== status) return false;
    if (group && groupOf(u) !== group) return false;
    if (capDef && capValue !== undefined && !matches(capDef, u.capabilities[capDef.key]?.value, capValue)) return false;
    return true;
  });
  const counts = Object.fromEntries(GEAR_STATUSES.map((s) => [s, own.filter((u) => u.status === s).length]));

  const sel = 'rounded border border-line bg-card px-1.5 py-0.5 t-body outline-none focus:border-rust';

  return (
    <div className="t-body">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3">
        <span className="flex gap-3">
          {GEAR_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={status === s ? 'font-medium text-ink underline underline-offset-4' : 'text-muted hover:text-ink'}
            >
              {GEAR_STATUS_LABEL[s]} <span className="text-muted">{counts[s]}</span>
            </button>
          ))}
        </span>
        <select value={group} onChange={(e) => setGroup(e.target.value as GearGroup | '')} className={sel} aria-label="Filter by group">
          <option value="">All groups</option>
          {GEAR_GROUPS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>
        <span className="flex flex-wrap items-center gap-2">
          <select
            value={capKey}
            onChange={(e) => {
              setCapKey(e.target.value);
              setCapValue(undefined);
            }}
            className={sel}
            aria-label="Filter by capability"
          >
            <option value="">Any capability</option>
            {defs.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
          {capDef && <CapabilityInput def={capDef} value={capValue} onChange={setCapValue} />}
          {capDef && (capDef.valueType === 'integer' || capDef.valueType === 'number') && (
            <span className="t-small text-muted">or more</span>
          )}
        </span>
        <button onClick={() => setAdding((a) => !a)} className={`ml-auto ${BUTTON_PRIMARY}`}>
          {adding ? 'Close' : 'Add gear'}
        </button>
      </div>

      {adding && (
        <AddGear
          onAdded={(u) => {
            setUnits((list) => [...list, u]);
            setStatus(u.status);
            setAdding(false);
          }}
        />
      )}

      {shown.length === 0 ? (
        <p className="py-6 text-muted">
          {own.length === 0 ? 'No gear yet. Add your first piece above.' : 'Nothing here matches.'}
        </p>
      ) : (
        <UnitTable
          units={shown}
          defByKey={defByKey}
          onMove={async (u, to) => {
            const r = await api<{ unit: GearUnit }>(`/api/gear/${u.id}`, { method: 'PATCH', body: JSON.stringify({ status: to }) });
            if (r.ok) setUnits((list) => list.map((x) => (x.id === u.id ? { ...x, status: to } : x)));
          }}
        />
      )}

      {shared.length > 0 && (
        <section className="mt-10">
          <h2 className="t-label mb-3 border-b border-line pb-1">Shared with me</h2>
          <UnitTable units={shared} defByKey={defByKey} showOwner />
        </section>
      )}
    </div>
  );
}

// One click between owned and wishlist, on the owner's own list.
const MOVE: Partial<Record<GearStatus, { to: GearStatus; label: string }>> = {
  owned: { to: 'wishlist', label: 'To wishlist' },
  wishlist: { to: 'owned', label: 'I have it' },
  gone: { to: 'owned', label: 'Back to owned' },
};

function UnitTable({
  units,
  defByKey,
  showOwner = false,
  onMove,
}: {
  units: GearUnit[];
  defByKey: Map<string, CapabilityDef>;
  showOwner?: boolean;
  onMove?: (u: GearUnit, to: GearStatus) => void;
}) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {units.map((u) => (
        <li key={u.id} className="group flex items-center hover:bg-ink/5">
          <Link href={`/gear/${u.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-1 pr-2">
            {u.photoUrl ? (
              <RotatedImage src={u.photoUrl} alt="" rotation={u.photoRotation} width={28} height={28} className="rounded-sm" />
            ) : (
              <span className="h-7 w-7 shrink-0 rounded-sm bg-line/60" />
            )}
            <span className="w-44 shrink-0 truncate sm:w-60">
              <span className="text-muted">{u.model?.manufacturer ?? u.manufacturer}</span> {u.model?.model ?? u.name}
              {u.nickname && <span className="text-muted"> · {u.nickname}</span>}
            </span>
            <span className="hidden w-32 shrink-0 truncate text-muted md:block">{groupLabel(groupOf(u))}</span>
            <span className="hidden min-w-0 flex-1 truncate t-small text-muted lg:block">
              {[
                u.model?.category,
                ...SUMMARY_KEYS.filter((k) => u.capabilities[k]).map(
                  (k) => `${defByKey.get(k)?.label ?? k}: ${formatCapability(defByKey.get(k), u.capabilities[k].value)}`,
                ),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {u.model?.status === 'suggested' && <span className="t-small text-muted">model awaiting approval</span>}
            {showOwner && <span className="t-small text-muted">{u.ownerName}</span>}
          </Link>
          {onMove && MOVE[u.status] && (
            <button
              onClick={() => onMove(u, MOVE[u.status]!.to)}
              className={`mr-1 shrink-0 opacity-60 group-hover:opacity-100 ${BUTTON}`}
            >
              {MOVE[u.status]!.label}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Add a unit: search the catalogue and pick a model, or name something that
 * is not there. A name can also be suggested to the catalogue, which makes it
 * a model the person can use at once and others can use once approved (G-6).
 */
function AddGear({ onAdded }: { onAdded: (u: GearUnit) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GearModel[]>([]);
  const [model, setModel] = useState<GearModel | null>(null);
  const [manual, setManual] = useState(false);
  const [manufacturer, setManufacturer] = useState('');
  const [name, setName] = useState('');
  const [suggest, setSuggest] = useState(true);
  const [kind, setKind] = useState<GearKind>('hardware');
  const [category, setCategory] = useState<GearCategory>('synthesizer');
  const [nickname, setNickname] = useState('');
  const [status, setStatus] = useState<GearStatus>('owned');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (manual || model) return;
    const t = setTimeout(async () => {
      const r = await api<{ models: GearModel[] }>(`/api/gear-models?q=${encodeURIComponent(q)}`, { method: 'GET' });
      if (r.ok) setResults(r.data.models);
    }, 200);
    return () => clearTimeout(t);
  }, [q, manual, model]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    let modelId = model?.id ?? null;
    if (!modelId && manual && suggest) {
      const s = await api<{ model: GearModel }>('/api/gear-models', {
        method: 'POST',
        body: JSON.stringify({ kind, category, manufacturer, model: name }),
      });
      if (s.ok) modelId = s.data.model.id;
      else if (s.status === 409 && s.body.existing) modelId = s.body.existing.id;
      else {
        setBusy(false);
        setError(s.body.error || 'Could not suggest the model.');
        return;
      }
    }
    const r = await api<{ unit: GearUnit }>('/api/gear', {
      method: 'POST',
      body: JSON.stringify(modelId ? { modelId, nickname, status } : { manufacturer, name, nickname, status }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not add the gear.');
      return;
    }
    onAdded(r.data.unit);
  }

  const field = 'rounded border border-line bg-parchment px-2 py-1.5 t-body outline-none focus:border-rust';

  return (
    <form onSubmit={save} className="mb-6 space-y-3 rounded-lg border border-line bg-card p-4 t-body">
      {model ? (
        <p>
          <span className="font-medium">
            {model.manufacturer} {model.model}
          </span>{' '}
          <span className="text-muted">· {model.category}</span>{' '}
          <button type="button" onClick={() => setModel(null)} className={BUTTON}>
            change
          </button>
        </p>
      ) : manual ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted">Manufacturer</span>
            <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={`${field} w-44`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Model</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={`${field} w-56`} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} />
            Suggest it for the catalogue
          </label>
          {suggest && (
            <>
              <select value={kind} onChange={(e) => setKind(e.target.value as GearKind)} className={field} aria-label="Kind">
                {GEAR_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as GearCategory)}
                className={field}
                aria-label="Category"
              >
                {GEAR_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </>
          )}
          <button type="button" onClick={() => setManual(false)} className={BUTTON}>
            search the catalogue instead
          </button>
        </div>
      ) : (
        <div>
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the catalogue: manufacturer or model…"
            className={`${field} w-full sm:w-96`}
          />
          <ul className="mt-2 divide-y divide-line rounded border border-line sm:w-96">
            {results.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setModel(m)} className="flex w-full gap-2 px-3 py-1.5 text-left hover:bg-ink/5">
                  <span>
                    {m.manufacturer} {m.model}
                  </span>
                  <span className="ml-auto t-small text-muted">
                    {m.status === 'suggested' ? 'your suggestion' : m.category}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => {
                  setManual(true);
                  setName(q);
                }}
                className="w-full px-3 py-1.5 text-left text-muted hover:bg-ink/5"
              >
                Not in the catalogue? Add it by name…
              </button>
            </li>
          </ul>
        </div>
      )}

      {(model || manual) && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted">Nickname (optional)</span>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={`${field} w-44`} />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value as GearStatus)} className={field} aria-label="Status">
            <option value="owned">Owned</option>
            <option value="wishlist">Wishlist</option>
          </select>
          <button disabled={busy} className={BUTTON_PRIMARY}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}
      {error && <p className="text-rust">{error}</p>}
    </form>
  );
}

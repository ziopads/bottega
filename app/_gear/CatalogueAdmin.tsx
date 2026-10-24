'use client';

import { useState } from 'react';

import { api, InlineEdit } from '@/app/_studio/controls';
import type { CapabilityDef, CapabilityValue, GearModel } from '@/lib/gearTypes';
import { GEAR_CATEGORIES, GEAR_KINDS, formatCapability, type GearCategory, type GearKind } from '@/lib/gearTypes';
import { CapabilityEditor } from './CapabilityEditor';
import { BUTTON, BUTTON_DANGER } from '@/app/_ui/styles';

// Suggestions first, each approved or rejected with one click; then every
// model, opened to edit its facts and capabilities.

export default function CatalogueAdmin({ initialModels, defs }: { initialModels: GearModel[]; defs: CapabilityDef[] }) {
  const [models, setModels] = useState(initialModels);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  function replace(m: GearModel) {
    setModels((list) => list.map((x) => (x.id === m.id ? m : x)));
  }

  async function patch(id: number, fields: Record<string, unknown>): Promise<boolean> {
    setError('');
    const r = await api<{ model: GearModel }>(`/api/gear-models/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    if (!r.ok) {
      setError(r.body.error || 'Could not save.');
      return false;
    }
    replace(r.data.model);
    return true;
  }

  async function saveCapability(id: number, key: string, value: CapabilityValue | null): Promise<boolean> {
    setError('');
    const r = await api<{ model: GearModel }>(`/api/gear-models/${id}/capabilities`, {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not save the capability.');
      return false;
    }
    replace(r.data.model);
    return true;
  }

  const suggested = models.filter((m) => m.status === 'suggested');
  const rest = models
    .filter((m) => m.status !== 'suggested')
    .filter((m) => !filter || `${m.manufacturer} ${m.model}`.toLowerCase().includes(filter.toLowerCase()));
  const sel = 'rounded border border-line bg-card px-2 py-1 t-body';

  const row = (m: GearModel) => (
    <li key={m.id} className="py-2">
      <div className="flex flex-wrap items-baseline gap-3 t-body">
        <button onClick={() => setOpen(open === m.id ? null : m.id)} className="min-w-0 flex-1 text-left hover:text-rust">
          {m.manufacturer} {m.model}
          <span className="t-small text-muted">
            {' '}
            · {m.category} · {m.kind}
            {m.status !== 'approved' && ` · ${m.status}`} · suggested by {m.suggestedByName}
          </span>
        </button>
        {m.status !== 'approved' && (
          <button onClick={() => patch(m.id, { status: 'approved' })} className={BUTTON}>
            Approve
          </button>
        )}
        {m.status !== 'rejected' && (
          <button onClick={() => patch(m.id, { status: 'rejected' })} className={BUTTON_DANGER}>
            Reject
          </button>
        )}
      </div>
      {open === m.id && (
        <div className="mt-3 space-y-3 rounded-lg border border-line bg-card p-3 t-body">
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-40">
              <InlineEdit value={m.manufacturer} placeholder="manufacturer" label="Manufacturer" onSave={(v) => patch(m.id, { manufacturer: v })} />
            </span>
            <span className="w-56">
              <InlineEdit value={m.model} placeholder="model" label="Model" onSave={(v) => patch(m.id, { model: v })} />
            </span>
            <select value={m.kind} onChange={(e) => patch(m.id, { kind: e.target.value as GearKind })} className={sel} aria-label="Kind">
              {GEAR_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <select
              value={m.category}
              onChange={(e) => patch(m.id, { category: e.target.value as GearCategory })}
              className={sel}
              aria-label="Category"
            >
              {GEAR_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <span className="flex items-baseline gap-1">
              <span className="w-14">
                <InlineEdit
                  value={m.yearIntroduced === null ? '' : String(m.yearIntroduced)}
                  placeholder="from"
                  label="Year introduced"
                  inputMode="decimal"
                  onSave={(v) => patch(m.id, { yearIntroduced: v || null })}
                />
              </span>
              –
              <span className="w-14">
                <InlineEdit
                  value={m.yearDiscontinued === null ? '' : String(m.yearDiscontinued)}
                  placeholder="still made"
                  label="Year discontinued"
                  inputMode="decimal"
                  onSave={(v) => patch(m.id, { yearDiscontinued: v || null })}
                />
              </span>
            </span>
          </div>
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {defs.map((d) => (
                <tr key={d.key} className="align-top">
                  <td className="w-44 py-1.5 pr-4 text-muted">{d.label}</td>
                  <td className="py-1.5">
                    <CapabilityEditor
                      def={d}
                      initial={m.capabilities[d.key]}
                      clearLabel="clear"
                      onSave={(v) => saveCapability(m.id, d.key, v)}
                    />
                  </td>
                  <td className="w-48 py-1.5 text-right t-small text-muted">
                    {m.capabilities[d.key] !== undefined && formatCapability(d, m.capabilities[d.key])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-8">
      {error && <p className="t-body text-rust">{error}</p>}
      <section>
        <h2 className="t-label mb-3 border-b border-line pb-1">Suggestions ({suggested.length})</h2>
        {suggested.length === 0 ? (
          <p className="t-body text-muted">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">{suggested.map(row)}</ul>
        )}
      </section>
      <section>
        <div className="mb-3 flex items-baseline gap-4 border-b border-line pb-1">
          <h2 className="t-label">Models ({rest.length})</h2>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter"
            className="rounded border border-line bg-card px-2 py-1 t-body"
          />
        </div>
        <ul className="divide-y divide-line border-y border-line">{rest.map(row)}</ul>
      </section>
    </div>
  );
}

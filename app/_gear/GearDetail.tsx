'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import Sharing from '@/app/_studio/Sharing';
import { api, InlineEdit } from '@/app/_studio/controls';
import type { CapabilityDef, CapabilityValue, GearFile, GearPrivate, GearStatus, GearUnit } from '@/lib/gearTypes';
import { FILE_ROLE_LABEL, GEAR_STATUS_LABEL, GEAR_STATUSES, formatCapability, unitTitle } from '@/lib/gearTypes';
import { formatBytes, levelAtLeast, type StudioShare } from '@/lib/studioTypes';
import { CapabilityEditor } from './CapabilityEditor';
import DropZone from './DropZone';
import PhotoEditor from './PhotoEditor';
import RotatedImage from './RotatedImage';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';

// One unit: what it is, its capabilities (the model's, with this unit's
// overrides), its photos, and for its owner the insurance record, the private
// files and who it is shared with (REQUIREMENTS G-1 to G-7). Controls follow
// the viewer's level; the routes and the database enforce the same rules.

export default function GearDetail({
  initialUnit,
  defs,
  initialFiles,
  initialRecord,
  initialShares,
  uploadsEnabled,
}: {
  initialUnit: GearUnit;
  defs: CapabilityDef[];
  initialFiles: GearFile[];
  /** The insurance record; null unless the viewer owns the unit. */
  initialRecord: GearPrivate | null;
  initialShares: StudioShare[];
  uploadsEnabled: boolean;
}) {
  const router = useRouter();
  const [unit, setUnit] = useState(initialUnit);
  const [files, setFiles] = useState(initialFiles);
  const [error, setError] = useState('');
  const [editingCaps, setEditingCaps] = useState(false);
  const [armed, setArmed] = useState(false);
  const [editing, setEditing] = useState<GearFile | null>(null);
  const isOwner = unit.level === 'owner';
  const canEdit = levelAtLeast(unit.level, 'edit');
  const canContribute = levelAtLeast(unit.level, 'contribute');

  async function patch(fields: Record<string, unknown>): Promise<boolean> {
    setError('');
    const r = await api<{ unit: GearUnit }>(`/api/gear/${unit.id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    if (!r.ok) {
      setError(r.body.error || 'Could not save the change.');
      return false;
    }
    setUnit(r.data.unit);
    return true;
  }

  async function saveCapability(key: string, value: CapabilityValue | null): Promise<boolean> {
    setError('');
    const r = await api<{ unit: GearUnit }>(`/api/gear/${unit.id}/capabilities`, {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    });
    if (!r.ok) {
      setError(r.body.error || 'Could not save the capability.');
      return false;
    }
    setUnit(r.data.unit);
    return true;
  }

  async function remove() {
    const r = await api(`/api/gear/${unit.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setError(r.body.error || 'Could not delete.');
      return;
    }
    router.push('/gear');
  }

  // Images in the gallery, whatever their role (a serial plate is a photo
  // too); everything else in the owner's list. What a grantee sees is
  // decided by each file's public flag, in the database (db/006).
  const photos = files.filter((f) => f.contentType.startsWith('image/'));
  const privateFiles = files.filter((f) => !f.contentType.startsWith('image/'));

  return (
    <div className="mt-4 space-y-10">
      {/* ── What it is ─────────────────────────────────────────────────── */}
      <div>
        <h1 className="t-title">{unitTitle(unit)}</h1>
        <p className="mt-1 t-body text-muted">
          {[unit.model?.category, unit.model?.kind].filter(Boolean).join(' · ')}
          {unit.model?.status === 'suggested' && ' · model awaiting approval'}
          {!unit.model && 'not in the catalogue'}
          {!isOwner && ` · shared by ${unit.ownerName}`}
        </p>

        <dl className="mt-4 grid max-w-2xl grid-cols-[8rem_1fr] gap-x-4 gap-y-2 t-body">
          <dt className="t-label pt-0.5">Nickname</dt>
          <dd>
            {canEdit ? (
              <InlineEdit value={unit.nickname} placeholder="—" label="Nickname" onSave={(v) => patch({ nickname: v })} />
            ) : (
              unit.nickname || '—'
            )}
          </dd>
          <dt className="t-label pt-0.5">Status</dt>
          <dd>
            {isOwner ? (
              <select
                value={unit.status}
                onChange={(e) => patch({ status: e.target.value as GearStatus })}
                className="rounded border border-line bg-card px-2 py-1"
              >
                {GEAR_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {GEAR_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            ) : (
              GEAR_STATUS_LABEL[unit.status]
            )}
          </dd>
          <dt className="t-label pt-0.5">Firmware</dt>
          <dd>
            {canEdit ? (
              <InlineEdit value={unit.firmware} placeholder="—" label="Firmware" onSave={(v) => patch({ firmware: v })} />
            ) : (
              unit.firmware || '—'
            )}
          </dd>
          <dt className="t-label pt-0.5">Notes</dt>
          <dd>
            {canEdit ? (
              <InlineEdit value={unit.notes} placeholder="—" label="Notes" onSave={(v) => patch({ notes: v })} />
            ) : (
              unit.notes || '—'
            )}
          </dd>
        </dl>
        {error && <p className="mt-3 t-body text-rust">{error}</p>}
      </div>

      {/* ── Capabilities ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-baseline gap-4 border-b border-line pb-1">
          <h2 className="t-label">Capabilities</h2>
          {canEdit && (
            <button onClick={() => setEditingCaps((x) => !x)} className={BUTTON}>
              {editingCaps ? 'done' : 'where this unit differs from its model…'}
            </button>
          )}
        </div>
        <table className="w-full max-w-3xl t-body">
          <tbody className="divide-y divide-line border-y border-line">
            {defs
              .filter((d) => editingCaps || unit.capabilities[d.key])
              .map((d) => {
                const c = unit.capabilities[d.key];
                return (
                  <tr key={d.key} className="align-top">
                    <td className="w-44 py-1.5 pr-4 text-muted" title={d.description}>
                      {d.label}
                    </td>
                    <td className="py-1.5">
                      {editingCaps ? (
                        <CapabilityEditor
                          def={d}
                          initial={c?.overridden ? c.value : undefined}
                          clearLabel="use the model's"
                          onSave={(v) => saveCapability(d.key, v)}
                        />
                      ) : (
                        c && formatCapability(d, c.value)
                      )}
                    </td>
                    <td className="w-28 py-1.5 text-right t-small text-muted">{c?.overridden ? 'this unit' : c ? 'model' : ''}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {!editingCaps && Object.keys(unit.capabilities).length === 0 && (
          <p className="t-body text-muted">No capabilities recorded yet.</p>
        )}
      </section>

      {/* ── Photos ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="t-label mb-3 border-b border-line pb-1">Photos</h2>
        {photos.length === 0 && <p className="t-body text-muted">No photos yet.</p>}
        <div className="flex flex-wrap gap-3">
          {photos.map((f) => (
            <figure key={f.id} className="w-40">
              <button
                onClick={() => setEditing(f)}
                className="relative block rounded focus:outline-none focus:ring-2 focus:ring-rust"
                aria-label={isOwner ? `Edit ${f.caption || f.filename}` : `View ${f.caption || f.filename}`}
              >
                <RotatedImage src={f.urls?.thumb ?? `/api/gear-files/${f.id}`} alt={f.caption || f.filename} rotation={f.rotation} width={160} height={128} className="rounded" />
                {isOwner && !f.isPublic && (
                  <span className="absolute left-1 top-1 rounded bg-ink/75 px-1.5 py-0.5 t-small uppercase tracking-wide text-parchment">
                    Private
                  </span>
                )}
              </button>
              <figcaption className="mt-1 flex items-baseline gap-2 t-small text-muted">
                <span className="min-w-0 flex-1 truncate">{f.caption || f.filename}</span>
                {f.role !== 'photo' && <span>{FILE_ROLE_LABEL[f.role]}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
        {isOwner && photos.length > 0 && (
          <p className="mt-2 t-small text-muted">Click a photo to turn it, make it public or private, or delete it. Private photos are yours alone.</p>
        )}
        {editing && (
          <PhotoEditor
            file={editing}
            isOwner={isOwner}
            onClose={() => setEditing(null)}
            onSaved={(f) => {
              setFiles((l) => l.map((x) => (x.id === f.id ? f : x)));
              setEditing(null);
            }}
            onDeleted={() => {
              setFiles((l) => l.filter((x) => x.id !== editing.id));
              setEditing(null);
            }}
          />
        )}
        {canContribute && uploadsEnabled && (
          <DropZone gearId={unit.id} isOwner={isOwner} onUploaded={(f) => setFiles((l) => [...l, f])} />
        )}
      </section>

      {/* ── Owner only ──────────────────────────────────────────────────── */}
      {isOwner && (
        <>
          <section>
            <h2 className="t-label mb-3 border-b border-line pb-1">Receipts and documents</h2>
            <p className="mb-3 t-small text-muted">Only you can see these, whoever the unit is shared with.</p>
            {privateFiles.length === 0 ? (
              <p className="t-body text-muted">None yet. Drop a PDF above to add a receipt or document. Images appear with the photos.</p>
            ) : (
              <ul className="space-y-1 t-body">
                {privateFiles.map((f) => (
                  <li key={f.id} className="flex items-baseline gap-3">
                    <span className="w-24 t-small text-muted">{FILE_ROLE_LABEL[f.role]}</span>
                    <a href={`/api/gear-files/${f.id}?download=1`} className="min-w-0 flex-1 truncate underline hover:text-rust">
                      {f.filename}
                    </a>
                    <span className="t-small text-muted">{formatBytes(f.bytes)}</span>
                    <FileDelete file={f} onDeleted={() => setFiles((l) => l.filter((x) => x.id !== f.id))} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {initialRecord && <InsuranceRecord gearId={unit.id} initial={initialRecord} isSoftware={unit.model?.kind === 'software'} />}

          <Sharing
            sharesUrl={`/api/gear/${unit.id}/shares`}
            initialShares={initialShares}
            note="A share shows the unit, its capabilities, firmware and photos. Serial, price, location, receipts and licence details stay with you."
          />

          <div className="t-small">
            {armed ? (
              <span className="flex gap-3">
                <button onClick={remove} className={BUTTON_PRIMARY}>
                  Confirm: delete this unit and its files
                </button>
                <button onClick={() => setArmed(false)} className={BUTTON}>
                  cancel
                </button>
              </span>
            ) : (
              <button onClick={() => setArmed(true)} className={BUTTON_DANGER}>
                Delete this unit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FileDelete({ file, onDeleted }: { file: GearFile; onDeleted: () => void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button onClick={() => setArmed(true)} className={BUTTON_DANGER}>
        delete
      </button>
    );
  }
  return (
    <span className="flex gap-2 t-small">
      <button
        onClick={async () => {
          const r = await api(`/api/gear-files/${file.id}`, { method: 'DELETE' });
          if (r.ok) onDeleted();
        }}
        className={BUTTON_PRIMARY}
      >
        confirm
      </button>
      <button onClick={() => setArmed(false)} className={BUTTON}>
        cancel
      </button>
    </span>
  );
}

/** The insurance record: owner only (REQUIREMENTS G-2). Saved as one form. */
function InsuranceRecord({ gearId, initial, isSoftware }: { gearId: number; initial: GearPrivate; isSoftware: boolean }) {
  const [rec, setRec] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dirty = JSON.stringify(rec) !== JSON.stringify(saved);
  const field = 'w-full rounded border border-line bg-card px-2 py-1 t-body outline-none focus:border-rust';
  const set = <K extends keyof GearPrivate>(k: K, v: GearPrivate[K]) => setRec((r) => ({ ...r, [k]: v }));

  async function save() {
    setBusy(true);
    setMessage('');
    const r = await api<{ record: GearPrivate }>(`/api/gear/${gearId}/private`, { method: 'PATCH', body: JSON.stringify(rec) });
    setBusy(false);
    if (!r.ok) {
      setMessage(r.body.error || 'Could not save.');
      return;
    }
    setRec(r.data.record);
    setSaved(r.data.record);
    setMessage('Saved.');
  }

  const text = (k: keyof GearPrivate, label: string) => (
    <label className="flex flex-col gap-1">
      <span className="t-small text-muted">{label}</span>
      <input value={String(rec[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} className={field} />
    </label>
  );

  return (
    <section>
      <h2 className="t-label mb-3 border-b border-line pb-1">Insurance record</h2>
      <p className="mb-3 t-small text-muted">Only you can see this, whoever the unit is shared with.</p>
      <div className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
        {text('serial', 'Serial number')}
        <label className="flex flex-col gap-1">
          <span className="t-small text-muted">Purchased</span>
          <input type="date" value={rec.purchaseDate ?? ''} onChange={(e) => set('purchaseDate', e.target.value || null)} className={field} />
        </label>
        <span className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="t-small text-muted">Price</span>
            <input
              inputMode="decimal"
              value={rec.purchasePrice ?? ''}
              onChange={(e) => set('purchasePrice', e.target.value === '' ? null : (e.target.value as unknown as number))}
              className={field}
            />
          </label>
          <label className="flex w-20 flex-col gap-1">
            <span className="t-small text-muted">Currency</span>
            <input value={rec.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} className={field} />
          </label>
        </span>
        {text('purchasedFrom', 'Bought from')}
        <label className="flex flex-col gap-1">
          <span className="t-small text-muted">Estimated value</span>
          <input
            inputMode="decimal"
            value={rec.estimatedValue ?? ''}
            onChange={(e) => set('estimatedValue', e.target.value === '' ? null : (e.target.value as unknown as number))}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-small text-muted">Valued on</span>
          <input type="date" value={rec.valuedOn ?? ''} onChange={(e) => set('valuedOn', e.target.value || null)} className={field} />
        </label>
        {text('condition', 'Condition')}
        {text('location', 'Location')}
        <label className="flex flex-col gap-1 sm:col-span-3">
          <span className="t-small text-muted">Service history</span>
          <textarea
            rows={2}
            value={rec.serviceHistory}
            onChange={(e) => set('serviceHistory', e.target.value)}
            className={field}
          />
        </label>
        {isSoftware && (
          <>
            {text('licenseKey', 'Licence key')}
            <label className="flex flex-col gap-1">
              <span className="t-small text-muted">Seats</span>
              <input
                inputMode="numeric"
                value={rec.licenseSeats ?? ''}
                onChange={(e) => set('licenseSeats', e.target.value === '' ? null : (e.target.value as unknown as number))}
                className={field}
              />
            </label>
            {text('licenseActivation', 'Activation')}
            <label className="flex flex-col gap-1">
              <span className="t-small text-muted">Renewal</span>
              <input type="date" value={rec.licenseRenewal ?? ''} onChange={(e) => set('licenseRenewal', e.target.value || null)} className={field} />
            </label>
          </>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3 t-body">
        <button disabled={!dirty || busy} onClick={save} className={BUTTON_PRIMARY}>
          {busy ? 'Saving…' : 'Save record'}
        </button>
        {message && <span className="text-muted">{message}</span>}
      </div>
    </section>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import Sharing from '@/app/_studio/Sharing';
import { api, InlineEdit } from '@/app/_studio/controls';
import type { CapabilityDef, CapabilityValue, GearFile, GearFileRole, GearPrivate, GearStatus, GearUnit } from '@/lib/gearTypes';
import { FILE_ROLE_LABEL, FILE_ROLES, GEAR_STATUS_LABEL, GEAR_STATUSES, formatCapability, unitTitle } from '@/lib/gearTypes';
import { formatBytes, levelAtLeast, type StudioShare } from '@/lib/studioTypes';
import { CapabilityEditor } from './CapabilityEditor';

// One unit: what it is, its capabilities (the model's, with this unit's
// overrides), its photos, and for its owner the insurance record, the private
// files and who it is shared with (REQUIREMENTS G-1 to G-7). Controls follow
// the viewer's level; the routes and the database enforce the same rules.

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

function putFile(url: string, file: File, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the upload (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('The upload could not reach storage (network or CORS).'));
    xhr.send(file);
  });
}

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

  const photos = files.filter((f) => f.role === 'photo');
  const privateFiles = files.filter((f) => f.role !== 'photo');

  return (
    <div className="mt-4 space-y-10">
      {/* ── What it is ─────────────────────────────────────────────────── */}
      <div>
        <h1 className="font-serif text-2xl sm:text-3xl">{unitTitle(unit)}</h1>
        <p className="mt-1 text-sm text-muted">
          {[unit.model?.category, unit.model?.kind].filter(Boolean).join(' · ')}
          {unit.model?.status === 'suggested' && ' · model awaiting approval'}
          {!unit.model && 'not in the catalogue'}
          {!isOwner && ` · shared by ${unit.ownerName}`}
        </p>

        <dl className="mt-4 grid max-w-2xl grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Nickname</dt>
          <dd>
            {canEdit ? (
              <InlineEdit value={unit.nickname} placeholder="—" label="Nickname" onSave={(v) => patch({ nickname: v })} />
            ) : (
              unit.nickname || '—'
            )}
          </dd>
          <dt className="text-muted">Status</dt>
          <dd>
            {isOwner ? (
              <select
                value={unit.status}
                onChange={(e) => patch({ status: e.target.value as GearStatus })}
                className="rounded-md border border-line bg-card px-2 py-1"
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
          <dt className="text-muted">Firmware</dt>
          <dd>
            {canEdit ? (
              <InlineEdit value={unit.firmware} placeholder="—" label="Firmware" onSave={(v) => patch({ firmware: v })} />
            ) : (
              unit.firmware || '—'
            )}
          </dd>
          <dt className="text-muted">Notes</dt>
          <dd>
            {canEdit ? (
              <InlineEdit value={unit.notes} placeholder="—" label="Notes" onSave={(v) => patch({ notes: v })} />
            ) : (
              unit.notes || '—'
            )}
          </dd>
        </dl>
        {error && <p className="mt-3 text-sm text-rust">{error}</p>}
      </div>

      {/* ── Capabilities ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-baseline gap-4">
          <h2 className="text-xs uppercase tracking-wide text-muted">Capabilities</h2>
          {canEdit && (
            <button onClick={() => setEditingCaps((x) => !x)} className="text-xs text-muted underline hover:text-ink">
              {editingCaps ? 'done' : 'where this unit differs from its model…'}
            </button>
          )}
        </div>
        <table className="w-full max-w-3xl text-sm">
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
                    <td className="w-28 py-1.5 text-right text-xs text-muted">{c?.overridden ? 'this unit' : c ? 'model' : ''}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {!editingCaps && Object.keys(unit.capabilities).length === 0 && (
          <p className="text-sm text-muted">No capabilities recorded yet.</p>
        )}
      </section>

      {/* ── Photos ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Photos</h2>
        {photos.length === 0 && <p className="text-sm text-muted">No photos yet.</p>}
        <div className="flex flex-wrap gap-3">
          {photos.map((f) => (
            <figure key={f.id} className="w-40">
              <a href={`/api/gear-files/${f.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/gear-files/${f.id}`} alt={f.caption || f.filename} className="h-32 w-40 rounded object-cover" />
              </a>
              <figcaption className="mt-1 flex items-baseline gap-2 text-xs text-muted">
                <span className="min-w-0 flex-1 truncate">{f.caption || f.filename}</span>
                {isOwner && <FileDelete file={f} onDeleted={() => setFiles((l) => l.filter((x) => x.id !== f.id))} />}
              </figcaption>
            </figure>
          ))}
        </div>
        {canContribute && uploadsEnabled && (
          <Upload gearId={unit.id} roles={isOwner ? [...FILE_ROLES] : ['photo']} onUploaded={(f) => setFiles((l) => [...l, f])} />
        )}
      </section>

      {/* ── Owner only ──────────────────────────────────────────────────── */}
      {isOwner && (
        <>
          <section>
            <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">Receipts and documents</h2>
            <p className="mb-3 text-xs text-muted">Only you can see these, whoever the unit is shared with.</p>
            {privateFiles.length === 0 ? (
              <p className="text-sm text-muted">None yet. Upload above, choosing receipt, serial plate or document.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {privateFiles.map((f) => (
                  <li key={f.id} className="flex items-baseline gap-3">
                    <span className="w-24 text-xs text-muted">{FILE_ROLE_LABEL[f.role]}</span>
                    <a href={`/api/gear-files/${f.id}?download=1`} className="min-w-0 flex-1 truncate underline hover:text-rust">
                      {f.filename}
                    </a>
                    <span className="text-xs text-muted">{formatBytes(f.bytes)}</span>
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

          <div className="text-xs">
            {armed ? (
              <span className="flex gap-3">
                <button onClick={remove} className="text-rust underline">
                  Confirm: delete this unit and its files
                </button>
                <button onClick={() => setArmed(false)} className="text-muted hover:text-ink">
                  cancel
                </button>
              </span>
            ) : (
              <button onClick={() => setArmed(true)} className="text-muted hover:text-rust">
                Delete this unit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Upload({ gearId, roles, onUploaded }: { gearId: number; roles: GearFileRole[]; onUploaded: (f: GearFile) => void }) {
  const [role, setRole] = useState<GearFileRole>(roles[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const contentType = file.type;
      const signed = await api<{ url: string; key: string }>(`/api/gear/${gearId}/files/upload`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType, bytes: file.size, role }),
      });
      if (!signed.ok) throw new Error(signed.body.error || 'Could not start the upload.');
      await putFile(signed.data.url, file, contentType);
      const saved = await api<{ file: GearFile }>(`/api/gear/${gearId}/files`, {
        method: 'POST',
        body: JSON.stringify({ key: signed.data.key, filename: file.name, role }),
      });
      if (!saved.ok) throw new Error(saved.body.error || 'Uploaded, but could not record the file.');
      onUploaded(saved.data.file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      {roles.length > 1 && (
        <select value={role} onChange={(e) => setRole(e.target.value as GearFileRole)} className="rounded-md border border-line bg-card px-2 py-1">
          {roles.map((r) => (
            <option key={r} value={r}>
              {FILE_ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={() => input.current?.click()}
        disabled={busy}
        className="rounded-md border border-line px-3 py-1 hover:border-ink disabled:opacity-50"
      >
        {busy ? 'Uploading…' : role === 'photo' ? 'Add a photo' : 'Upload a file'}
      </button>
      <span className="text-xs text-muted">JPEG, PNG, WebP, HEIC or PDF, up to 50 MB</span>
      <input
        ref={input}
        type="file"
        accept={role === 'photo' ? 'image/jpeg,image/png,image/webp,image/heic' : ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = '';
        }}
      />
      {error && <span className="text-rust">{error}</span>}
    </div>
  );
}

function FileDelete({ file, onDeleted }: { file: GearFile; onDeleted: () => void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button onClick={() => setArmed(true)} className="text-xs text-muted hover:text-rust">
        delete
      </button>
    );
  }
  return (
    <span className="flex gap-2 text-xs">
      <button
        onClick={async () => {
          const r = await api(`/api/gear-files/${file.id}`, { method: 'DELETE' });
          if (r.ok) onDeleted();
        }}
        className="text-rust underline"
      >
        confirm
      </button>
      <button onClick={() => setArmed(false)} className="text-muted">
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
  const field = 'w-full rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-rust';
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
      <span className="text-xs text-muted">{label}</span>
      <input value={String(rec[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} className={field} />
    </label>
  );

  return (
    <section>
      <h2 className="mb-1 text-xs uppercase tracking-wide text-muted">Insurance record</h2>
      <p className="mb-3 text-xs text-muted">Only you can see this, whoever the unit is shared with.</p>
      <div className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
        {text('serial', 'Serial number')}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Purchased</span>
          <input type="date" value={rec.purchaseDate ?? ''} onChange={(e) => set('purchaseDate', e.target.value || null)} className={field} />
        </label>
        <span className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-muted">Price</span>
            <input
              inputMode="decimal"
              value={rec.purchasePrice ?? ''}
              onChange={(e) => set('purchasePrice', e.target.value === '' ? null : (e.target.value as unknown as number))}
              className={field}
            />
          </label>
          <label className="flex w-20 flex-col gap-1">
            <span className="text-xs text-muted">Currency</span>
            <input value={rec.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} className={field} />
          </label>
        </span>
        {text('purchasedFrom', 'Bought from')}
        {text('condition', 'Condition')}
        {text('location', 'Location')}
        <label className="flex flex-col gap-1 sm:col-span-3">
          <span className="text-xs text-muted">Service history</span>
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
              <span className="text-xs text-muted">Seats</span>
              <input
                inputMode="numeric"
                value={rec.licenseSeats ?? ''}
                onChange={(e) => set('licenseSeats', e.target.value === '' ? null : (e.target.value as unknown as number))}
                className={field}
              />
            </label>
            {text('licenseActivation', 'Activation')}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Renewal</span>
              <input type="date" value={rec.licenseRenewal ?? ''} onChange={(e) => set('licenseRenewal', e.target.value || null)} className={field} />
            </label>
          </>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <button disabled={!dirty || busy} onClick={save} className="rounded-md bg-rust px-4 py-1.5 text-white disabled:opacity-40">
          {busy ? 'Saving…' : 'Save record'}
        </button>
        {message && <span className="text-muted">{message}</span>}
      </div>
    </section>
  );
}

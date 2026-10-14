'use client';

import { useEffect, useState } from 'react';

import { api } from '@/app/_studio/controls';
import type { GearFile, GearFileRole, Rotation } from '@/lib/gearTypes';
import { FILE_ROLE_LABEL, FILE_ROLES } from '@/lib/gearTypes';

import RotatedImage from './RotatedImage';
import { BUTTON, BUTTON_PRIMARY, BUTTON_SMALL, BUTTON_SMALL_DANGER, BUTTON_SMALL_PRIMARY } from '@/app/_ui/styles';

// The edit screen for one image on a unit (REQUIREMENTS G-9): turn it, say
// whether people the unit is shared with see it, caption it, say what it is,
// or delete it. Owner only; anyone else gets a larger view. Nothing is saved
// until Save, so turning a photo back and forth costs nothing.

function boxSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 720, height: 540 };
  return {
    width: Math.min(720, Math.round(window.innerWidth * 0.9) - 32),
    height: Math.min(540, Math.round(window.innerHeight * 0.6)),
  };
}

export default function PhotoEditor({
  file,
  isOwner,
  onClose,
  onSaved,
  onDeleted,
}: {
  file: GearFile;
  isOwner: boolean;
  onClose: () => void;
  onSaved: (f: GearFile) => void;
  onDeleted: () => void;
}) {
  const [rotation, setRotation] = useState<Rotation>(file.rotation);
  const [isPublic, setIsPublic] = useState(file.isPublic);
  const [caption, setCaption] = useState(file.caption);
  const [role, setRole] = useState<GearFileRole>(file.role);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState('');
  const [box, setBox] = useState(boxSize);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onResize = () => setBox(boxSize());
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  const turn = (by: 90 | -90) => setRotation((r) => (((r + by) % 360) + 360) % 360 as Rotation);
  const dirty =
    rotation !== file.rotation || isPublic !== file.isPublic || caption.trim() !== file.caption || role !== file.role;

  async function save() {
    setBusy(true);
    setError('');
    const r = await api<{ file: GearFile }>(`/api/gear-files/${file.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ rotation, isPublic, caption: caption.trim(), role }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not save.');
      return;
    }
    onSaved(r.data.file);
  }

  async function remove() {
    setBusy(true);
    const r = await api(`/api/gear-files/${file.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not delete.');
      return;
    }
    onDeleted();
  }


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isOwner ? 'Edit photo' : 'Photo'}
    >
      <div className="max-h-full overflow-auto rounded-lg bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <RotatedImage
          src={file.urls?.view ?? `/api/gear-files/${file.id}`}
          alt={file.caption || file.filename}
          rotation={rotation}
          width={box.width}
          height={box.height}
          fit="contain"
          className="rounded bg-ink/5"
        />

        {isOwner ? (
          <div className="mt-4 space-y-3 t-body" style={{ width: box.width }}>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => turn(-90)} className={BUTTON} aria-label="Rotate left">
                ⟲ Rotate left
              </button>
              <button onClick={() => turn(90)} className={BUTTON} aria-label="Rotate right">
                Rotate right ⟳
              </button>
              <select value={role} onChange={(e) => setRole(e.target.value as GearFileRole)} className="ml-auto rounded border border-line bg-card px-2 py-1">
                {FILE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {FILE_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="mt-1" />
              <span>
                Public
                <span className="block text-[11px] text-muted">
                  Shown to people you share this unit with. Leave it off for serial numbers, receipts or condition photos you keep to yourself.
                </span>
              </span>
            </label>
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption"
              className="w-full rounded border border-line bg-card px-2 py-1 outline-none focus:border-rust"
              aria-label="Caption"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={save} disabled={!dirty || busy} className={BUTTON_PRIMARY}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={onClose} className={BUTTON}>
                Cancel
              </button>
              <a href={`/api/gear-files/${file.id}?download=1`} className="text-muted hover:text-ink">
                {file.urls ? 'Download full size' : 'Download original'}
              </a>
              <span className="ml-auto">
                {armed ? (
                  <span className="flex gap-3">
                    <button onClick={remove} disabled={busy} className={BUTTON_SMALL_PRIMARY}>
                      Confirm delete
                    </button>
                    <button onClick={() => setArmed(false)} className={BUTTON_SMALL}>
                      cancel
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setArmed(true)} className={BUTTON_SMALL_DANGER}>
                    Delete
                  </button>
                )}
              </span>
            </div>
            {error && <p className="text-rust">{error}</p>}
          </div>
        ) : (
          <div className="mt-3 flex items-baseline gap-3 t-body" style={{ width: box.width }}>
            <span className="min-w-0 flex-1 truncate text-muted">{file.caption || file.filename}</span>
            <button onClick={onClose} className={BUTTON}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

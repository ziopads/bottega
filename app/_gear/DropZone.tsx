'use client';

import { useRef, useState } from 'react';

import type { GearFile, GearFileRole } from '@/lib/gearTypes';
import { FILE_ROLE_LABEL, FILE_ROLES } from '@/lib/gearTypes';
import { isConvertibleImage } from '@/lib/imageTypes';

import { uploadDocument, uploadImage } from './uploads';

// Drop images and PDFs onto a unit, or choose several at once (REQUIREMENTS
// G-10). Files go up one after another, each image made into its web
// versions in this browser first, so a batch from a phone does not hold a
// dozen full-size photos in memory at once. Contributors add photos only.

type Item = { key: string; name: string; status: 'waiting' | 'preparing' | 'uploading' | 'done' | 'error'; message?: string };

const STATUS: Record<Item['status'], string> = {
  waiting: 'waiting',
  preparing: 'resizing',
  uploading: 'uploading',
  done: 'done',
  error: 'failed',
};

export default function DropZone({
  gearId,
  isOwner,
  onUploaded,
}: {
  gearId: number;
  isOwner: boolean;
  onUploaded: (f: GearFile) => void;
}) {
  const [role, setRole] = useState<GearFileRole>('photo');
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function run(files: File[]) {
    if (!files.length) return;
    const batch = files.map((f, n) => ({ file: f, item: { key: `${Date.now()}-${n}-${f.name}`, name: f.name, status: 'waiting' as const } }));
    setItems((list) => [...list.filter((i) => i.status !== 'done'), ...batch.map((b) => b.item)]);
    setBusy(true);
    for (const { file, item } of batch) {
      try {
        let saved: GearFile;
        if (isConvertibleImage(file)) {
          saved = await uploadImage(gearId, file, role, (step) => update(item.key, { status: step }));
        } else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
          if (!isOwner) throw new Error('Only the owner adds documents.');
          update(item.key, { status: 'uploading' });
          saved = await uploadDocument(gearId, file, role === 'photo' ? 'document' : role);
        } else {
          throw new Error('Images and PDFs only.');
        }
        update(item.key, { status: 'done' });
        onUploaded(saved);
      } catch (err) {
        update(item.key, { status: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
      }
    }
    setBusy(false);
  }

  return (
    <div className="mt-4 t-body">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          run(Array.from(e.dataTransfer.files));
        }}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && input.current?.click()}
        role="button"
        tabIndex={0}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
          over ? 'border-rust bg-rust/5' : 'border-line hover:border-ink'
        }`}
      >
        <span>{busy ? 'Uploading…' : 'Drop photos here, or click to choose'}</span>
        <span className="t-small text-muted">
          {isOwner ? 'Images and PDFs, several at once. ' : 'Images, several at once. '}
          Photos are resized here before they upload; location data is removed.
        </span>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={isOwner ? 'image/*,.heic,.heif,application/pdf' : 'image/*,.heic,.heif'}
        className="hidden"
        onChange={(e) => {
          run(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      {isOwner && (
        <label className="mt-2 flex items-center gap-2 t-small text-muted">
          Add as
          <select value={role} onChange={(e) => setRole(e.target.value as GearFileRole)} className="rounded border border-line bg-card px-2 py-0.5">
            {FILE_ROLES.map((r) => (
              <option key={r} value={r}>
                {FILE_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <span>{role === 'photo' ? 'public; change it per photo afterwards' : 'private'}</span>
        </label>
      )}
      {items.length > 0 && (
        <ul className="mt-2 space-y-0.5 t-small">
          {items.map((i) => (
            <li key={i.key} className="flex gap-3">
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              <span className={i.status === 'error' ? 'text-rust' : 'text-muted'}>{i.message ?? STATUS[i.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

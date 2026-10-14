'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';
import type { DocumentKind, FingerprintMatch, StudioDocument } from '@/lib/documentTypes';
import { DOCUMENT_CONTENT_TYPE, DOCUMENT_KIND_LABEL, DOCUMENT_KINDS, LIBRARY_KINDS } from '@/lib/documentTypes';
import { formatBytes } from '@/lib/studioTypes';

// Adding documents to the Library (REQUIREMENTS K-4, K-6, K-8): one PDF or
// many, chosen with the buttons or dropped on the zone (several files, or a
// whole folder, whose PDFs are found in its subfolders too). "Private or
// library" is asked first, with no default, and holds for the whole batch.
//
// Each file goes through the same steps as before, one at a time: its
// fingerprint, the duplicate check, a signed upload straight to storage, and
// the record. Nothing is processed here: each document then waits in the
// lists below to be opened, checked, linked, approved and processed. A
// library upload arrives as submitted, the administrator's too, so it shows
// under "Your submissions" until approved. A single file opens its page when
// it is added, as before.

const field = 'rounded border border-line bg-card px-2 py-1 t-body outline-none focus:border-rust';

const MAX_BYTES = 150 * 1024 * 1024; // DOCUMENT_MAX_BYTES in lib/files.ts, which is server-only

type Status = 'waiting' | 'working' | 'added' | 'exists' | 'skipped' | 'failed';

type Item = {
  key: string;
  file: File;
  title: string;
  status: Status;
  detail: string;
  /** The document added, or the one that already holds this file. */
  link: { id: number; label: string } | null;
};

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function putFile(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', DOCUMENT_CONTENT_TYPE);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage refused the upload (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('The upload could not reach storage (network or CORS).'));
    xhr.send(file);
  });
}

const isPdf = (f: File) => (f.type ? f.type === DOCUMENT_CONTENT_TYPE : /\.pdf$/i.test(f.name));
const titleOf = (name: string) => name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

// ── Reading a drop: files, and folders walked to the bottom ─────────────────

type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: Entry[]) => void, fail: (e: unknown) => void) => void };
};

async function filesOf(entry: Entry): Promise<File[]> {
  if (entry.isFile && entry.file) {
    return [await new Promise<File>((ok, fail) => entry.file!(ok, fail))];
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const all: Entry[] = [];
    // readEntries answers in pieces; read until it answers with none.
    for (;;) {
      const batch = await new Promise<Entry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (!batch.length) break;
      all.push(...batch);
    }
    return (await Promise.all(all.filter((e) => !e.name.startsWith('.')).map(filesOf))).flat();
  }
  return [];
}

async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .map((i) => (i.kind === 'file' ? (i.webkitGetAsEntry() as unknown as Entry | null) : null))
    .filter((e): e is Entry => !!e);
  if (!entries.length) return Array.from(dt.files);
  return (await Promise.all(entries.map(filesOf))).flat();
}

export default function Upload() {
  const router = useRouter();
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // Asked first, with no default (K-4, K-6).
  const [library, setLibrary] = useState<boolean | null>(null);
  const [kind, setKind] = useState<DocumentKind>('manual');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);

  const single = items.length === 1;

  function chooseHome(toLibrary: boolean) {
    setLibrary(toLibrary);
    setKind(toLibrary ? 'manual' : 'book');
  }

  function add(files: File[]) {
    const fresh: Item[] = files
      .filter((f) => !f.name.startsWith('.'))
      .map((f, i) => {
        const skip = !isPdf(f) ? 'not a PDF' : f.size > MAX_BYTES ? `over ${MAX_BYTES / (1024 * 1024)} MB` : f.size === 0 ? 'empty' : '';
        return {
          key: `${f.name}-${f.size}-${f.lastModified}-${Date.now()}-${i}`,
          file: f,
          title: titleOf(f.name),
          status: skip ? 'skipped' : 'waiting',
          detail: skip,
          link: null,
        } satisfies Item;
      });
    setItems((list) => {
      // The same file chosen twice is listed once.
      const seen = new Set(list.map((x) => `${x.file.name}|${x.file.size}|${x.file.lastModified}`));
      return [...list, ...fresh.filter((x) => !seen.has(`${x.file.name}|${x.file.size}|${x.file.lastModified}`))].sort((a, b) =>
        a.file.name.localeCompare(b.file.name),
      );
    });
  }

  function update(key: string, patch: Partial<Item>) {
    setItems((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  async function uploadOne(item: Item): Promise<number | null> {
    update(item.key, { status: 'working', detail: 'Fingerprinting…' });
    try {
      const sha = await sha256(item.file);
      const checked = await api<{ match: FingerprintMatch }>('/api/documents/check', { method: 'POST', body: JSON.stringify({ sha256: sha }) });
      if (!checked.ok) throw new Error(checked.body.error || 'Could not check the file.');
      const m = checked.data.match;
      if (library && m.library) {
        update(item.key, {
          status: 'exists',
          detail: m.library.visible ? 'The library already has this file.' : 'Already submitted by someone; it appears once approved.',
          link: m.library.visible ? { id: m.library.id, label: 'Open it' } : null,
        });
        return null;
      }
      if (!library && m.own) {
        update(item.key, { status: 'exists', detail: 'You already have this file.', link: { id: m.own.id, label: m.own.title } });
        return null;
      }
      update(item.key, { detail: 'Uploading…' });
      const signed = await api<{ url: string; key: string }>('/api/documents/upload', {
        method: 'POST',
        body: JSON.stringify({ library, contentType: DOCUMENT_CONTENT_TYPE, bytes: item.file.size, sha256: sha }),
      });
      if (!signed.ok) throw new Error(signed.body.error || 'Could not start the upload.');
      await putFile(signed.data.url, item.file);
      update(item.key, { detail: 'Recording…' });
      const saved = await api<{ document: StudioDocument }>('/api/documents', {
        method: 'POST',
        body: JSON.stringify({
          key: signed.data.key,
          library,
          title: item.title.trim() || titleOf(item.file.name),
          manufacturer: manufacturer.trim(),
          model: single ? model.trim() : '',
          kind,
          filename: item.file.name,
          sha256: sha,
        }),
      });
      if (!saved.ok) throw new Error(saved.body.error || 'Uploaded, but could not record the document.');
      update(item.key, { status: 'added', detail: '', link: { id: saved.data.document.id, label: 'Open' } });
      return saved.data.document.id;
    } catch (err) {
      update(item.key, { status: 'failed', detail: err instanceof Error ? err.message : 'Upload failed.' });
      return null;
    }
  }

  async function run() {
    if (library === null) return;
    setRunning(true);
    const todo = items.filter((x) => x.status === 'waiting' || x.status === 'failed');
    const added: number[] = [];
    for (const item of todo) {
      const id = await uploadOne(item);
      if (id !== null) added.push(id);
    }
    setRunning(false);
    if (todo.length === 1 && added.length === 1) router.push(`/library/${added[0]}`);
    else router.refresh();
  }

  const waiting = items.filter((x) => x.status === 'waiting' || x.status === 'failed').length;
  const counts = (s: Status) => items.filter((x) => x.status === s).length;

  return (
    <section className="rounded border border-line p-4">
      <h2 className="t-label mb-3 border-b border-line pb-1">Add documents</h2>
      <fieldset className="t-body mb-4 grid gap-2 sm:grid-cols-2" disabled={running}>
        <legend className="mb-2">What are you adding?</legend>
        {(
          [
            [false, 'Private documents', 'Books, notes, anything of your own. Only you, and the people and groups you share them with.'],
            [true, 'Manuals for the library', 'Manufacturers’ manuals, service manuals or firmware notes. Every account can read them once the administrator approves them.'],
          ] as const
        ).map(([value, label, help]) => (
          <label
            key={label}
            className={`flex cursor-pointer gap-2 rounded border px-3 py-2 ${library === value ? 'border-ink' : 'border-line hover:border-ink/50'}`}
          >
            <input type="radio" name="document-home" checked={library === value} onChange={() => chooseHome(value)} className="mt-1" />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-muted">{help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {library !== null && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!running) setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setOver(false);
              if (running) return;
              add(await droppedFiles(e.dataTransfer));
            }}
            className={`t-body flex flex-col items-center gap-2 rounded border border-dashed px-4 py-6 text-center ${over ? 'border-rust bg-rust/5' : 'border-line'}`}
          >
            <p>Drop PDFs or a folder here</p>
            <p className="flex flex-wrap justify-center gap-2 text-muted">
              or
              <button type="button" onClick={() => filesInput.current?.click()} disabled={running} className={BUTTON}>
                Choose PDFs
              </button>
              <button type="button" onClick={() => folderInput.current?.click()} disabled={running} className={BUTTON}>
                Choose a folder
              </button>
            </p>
            <p className="text-[11px] text-muted">PDFs up to 150 MB each; anything else is skipped. A folder’s subfolders are read too.</p>
            <input
              ref={filesInput}
              type="file"
              multiple
              accept={DOCUMENT_CONTENT_TYPE}
              className="hidden"
              onChange={(e) => {
                add(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              className="hidden"
              {...{ webkitdirectory: '' }}
              onChange={(e) => {
                add(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>

          {items.length > 0 && (
            <div className="mt-4 space-y-3 t-body">
              <div className="flex flex-wrap items-center gap-2">
                <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} disabled={running} className={field} aria-label="Kind">
                  {(library ? LIBRARY_KINDS : DOCUMENT_KINDS).map((k) => (
                    <option key={k} value={k}>
                      {DOCUMENT_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <input
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  disabled={running}
                  placeholder={single ? 'Manufacturer (Moog)' : 'Manufacturer, for all (optional)'}
                  className={`${field} w-56`}
                  aria-label="Manufacturer"
                />
                {single && (
                  <input value={model} onChange={(e) => setModel(e.target.value)} disabled={running} placeholder="Model (Matriarch)" className={`${field} w-40`} aria-label="Model" />
                )}
              </div>
              {!single && <p className="text-[11px] text-muted">The kind applies to every file here; models are set on each document’s page afterwards.</p>}

              <ul className="divide-y divide-line border-y border-line">
                {items.map((x) => (
                  <li key={x.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    {x.status === 'waiting' || x.status === 'failed' ? (
                      <input
                        value={x.title}
                        onChange={(e) => update(x.key, { title: e.target.value })}
                        disabled={running}
                        aria-label={`Title for ${x.file.name}`}
                        className={`${field} min-w-0 flex-1`}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{x.title}</span>
                    )}
                    <span className="t-num text-[11px] text-muted">{formatBytes(x.file.size)}</span>
                    <span
                      className={`w-40 text-right text-[11px] ${
                        x.status === 'added' ? 'text-moss' : x.status === 'failed' ? 'text-rust' : 'text-muted'
                      }`}
                    >
                      {x.status === 'working'
                        ? x.detail
                        : x.status === 'added'
                          ? 'Added'
                          : x.status === 'waiting'
                            ? 'Waiting'
                            : x.status === 'exists'
                              ? 'Already here'
                              : x.status === 'skipped'
                                ? `Skipped: ${x.detail}`
                                : 'Failed'}
                    </span>
                    {x.link ? (
                      <Link href={`/library/${x.link.id}`} className="w-12 text-[11px] text-rust hover:underline">
                        {x.link.label === 'Open' ? 'Open' : 'Open it'}
                      </Link>
                    ) : x.status !== 'working' && !running ? (
                      <button onClick={() => setItems((list) => list.filter((y) => y.key !== x.key))} className={BUTTON_DANGER}>
                        Remove
                      </button>
                    ) : (
                      <span className="w-12" />
                    )}
                    {(x.status === 'failed' || x.status === 'exists') && x.detail && (
                      <span className="basis-full text-[11px] text-muted">{x.detail}</span>
                    )}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-3">
                <button onClick={run} disabled={running || waiting === 0} className={BUTTON_PRIMARY}>
                  {running ? 'Adding…' : waiting === 1 ? 'Add 1 document' : `Add ${waiting} documents`}
                </button>
                {!running && (
                  <button onClick={() => setItems([])} className={BUTTON}>
                    Clear the list
                  </button>
                )}
                <span className="text-[11px] text-muted">
                  {[
                    counts('added') && `${counts('added')} added`,
                    counts('exists') && `${counts('exists')} already here`,
                    counts('skipped') && `${counts('skipped')} skipped`,
                    counts('failed') && `${counts('failed')} failed`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {library && counts('added') > 0 && (
                <p className="text-[11px] text-muted">
                  Added documents wait under “Your submissions” below: open each to fill in its model, link it to the catalogue, approve and
                  process it.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { api } from '@/app/_studio/controls';
import type { Allowance, DocumentKind, FingerprintMatch, StudioDocument } from '@/lib/documentTypes';
import { DOCUMENT_CONTENT_TYPE, DOCUMENT_KIND_LABEL, DOCUMENT_KINDS, LIBRARY_KINDS, REVIEW_LABEL, STATE_LABEL } from '@/lib/documentTypes';
import { formatBytes } from '@/lib/studioTypes';

// The library and the person's own documents (REQUIREMENTS §8): upload with
// the duplicate check (K-8), the allowance (K-10), and the lists by where a
// document stands. The routes and the database enforce every rule shown.

const field = 'rounded border border-line bg-card px-2 py-1 t-body outline-none focus:border-rust';

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

export default function Library({
  documents,
  allowance,
  viewerId,
  isAdmin,
}: {
  documents: StudioDocument[];
  allowance: Allowance | null;
  viewerId: string;
  isAdmin: boolean;
}) {
  const mine = documents.filter((d) => !d.library && d.ownerId === viewerId);
  const shared = documents.filter((d) => !d.library && d.ownerId !== viewerId);
  const submissions = documents.filter((d) => d.library && d.contributedBy === viewerId && d.reviewStatus !== 'approved');
  const queue = isAdmin ? documents.filter((d) => d.library && d.reviewStatus === 'submitted' && d.contributedBy !== viewerId) : [];
  const library = documents.filter((d) => d.library && d.reviewStatus === 'approved');

  return (
    <div className="space-y-10">
      <Upload />
      {allowance && <AllowanceLine a={allowance} />}
      {queue.length > 0 && <Section title="Awaiting your review" docs={queue} />}
      {submissions.length > 0 && <Section title="Your submissions" docs={submissions} />}
      <Section title="Your documents" docs={mine} empty="Nothing private yet. Books and anything not for the library go here." />
      {shared.length > 0 && <Section title="Shared with you" docs={shared} />}
      <Section title="Library" docs={library} empty="The library is empty. Upload a manual to start it." />
    </div>
  );
}

function AllowanceLine({ a }: { a: Allowance }) {
  const parts = [
    a.storageBytes === null
      ? `${formatBytes(a.storageUsed) || '0 KB'} stored`
      : `${formatBytes(a.storageUsed) || '0 KB'} of ${formatBytes(a.storageBytes)} stored`,
    a.pagesPerMonth === null
      ? `${a.pagesUsed.toLocaleString()} pages processed this month`
      : `${a.pagesUsed.toLocaleString()} of ${a.pagesPerMonth.toLocaleString()} pages processed this month`,
  ];
  return <p className="text-[11px] text-muted">{parts.join(' · ')}</p>;
}

function Section({ title, docs, empty }: { title: string; docs: StudioDocument[]; empty?: string }) {
  return (
    <section>
      <h2 className="t-label mb-3 border-b border-line pb-1">{title}</h2>
      {docs.length === 0 ? (
        <p className="t-body text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 t-body">
              <Link href={`/library/${d.id}`} className="font-medium hover:text-rust">
                {d.title}
              </Link>
              {(d.manufacturer || d.model) && <span className="text-muted">{[d.manufacturer, d.model].filter(Boolean).join(' ')}</span>}
              {d.kind !== 'manual' && <span className="text-muted">{DOCUMENT_KIND_LABEL[d.kind]}</span>}
              {d.library && d.reviewStatus !== 'approved' && <span className="text-rust">{REVIEW_LABEL[d.reviewStatus]}</span>}
              <span className="ml-auto text-[11px] text-muted">
                {d.state === 'ready' ? `${d.pageCount ?? 0} pages` : STATE_LABEL[d.state]}
                {d.picked ? ' · picked' : ''}
                {!d.library && d.ownerName && d.level !== 'owner' ? ` · ${d.ownerName}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Upload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [library, setLibrary] = useState(true);
  const [title, setTitle] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [kind, setKind] = useState<DocumentKind>('manual');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [match, setMatch] = useState<FingerprintMatch | null>(null);

  function choose(f: File | null) {
    setFile(f);
    setMatch(null);
    setError('');
    if (f && !title) setTitle(f.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim());
  }

  async function upload() {
    if (!file) return;
    setError('');
    setMatch(null);
    try {
      // Some systems report no type for a PDF; the name decides then.
      if (file.type ? file.type !== DOCUMENT_CONTENT_TYPE : !/\.pdf$/i.test(file.name)) throw new Error('Documents must be PDFs.');
      setBusy('Fingerprinting…');
      const sha = await sha256(file);
      const checked = await api<{ match: FingerprintMatch }>('/api/documents/check', { method: 'POST', body: JSON.stringify({ sha256: sha }) });
      if (!checked.ok) throw new Error(checked.body.error || 'Could not check the file.');
      if (library ? checked.data.match.library : checked.data.match.own) {
        setMatch(checked.data.match);
        return;
      }
      setBusy('Uploading…');
      const signed = await api<{ url: string; key: string }>('/api/documents/upload', {
        method: 'POST',
        body: JSON.stringify({ library, contentType: DOCUMENT_CONTENT_TYPE, bytes: file.size, sha256: sha }),
      });
      if (!signed.ok) {
        if (signed.body.match) setMatch(signed.body.match);
        throw new Error(signed.body.error || 'Could not start the upload.');
      }
      await putFile(signed.data.url, file);
      setBusy('Recording…');
      const saved = await api<{ document: StudioDocument }>('/api/documents', {
        method: 'POST',
        body: JSON.stringify({ key: signed.data.key, library, title, manufacturer, model, kind, filename: file.name, sha256: sha }),
      });
      if (!saved.ok) {
        if (saved.body.match) setMatch(saved.body.match);
        throw new Error(saved.body.error || 'Uploaded, but could not record the document.');
      }
      router.push(`/library/${saved.data.document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="rounded border border-line p-4">
      <h2 className="t-label mb-3 border-b border-line pb-1">Add a document</h2>
      <div className="flex flex-wrap items-center gap-3 t-body">
        <button onClick={() => input.current?.click()} className="rounded border border-line px-3 py-1 hover:border-ink">
          {file ? 'Choose another PDF' : 'Choose a PDF'}
        </button>
        {file && (
          <span className="text-muted">
            {file.name} · {formatBytes(file.size)}
          </span>
        )}
        <input
          ref={input}
          type="file"
          accept={DOCUMENT_CONTENT_TYPE}
          className="hidden"
          onChange={(e) => {
            choose(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
      </div>

      {file && (
        <div className="mt-4 space-y-3 t-body">
          <fieldset className="flex flex-wrap gap-x-5 gap-y-1">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={library}
                onChange={() => {
                  setLibrary(true);
                  if (!LIBRARY_KINDS.includes(kind)) setKind('manual');
                }}
              />
              A manual for the library, which others can use once it is approved
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={!library} onChange={() => setLibrary(false)} />
              Private: only you, and the people you share it with
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={`${field} w-72`} aria-label="Title" />
            <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="Manufacturer (Moog)" className={`${field} w-40`} aria-label="Manufacturer" />
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model (Matriarch)" className={`${field} w-40`} aria-label="Model" />
            <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} className={field} aria-label="Kind">
              {(library ? LIBRARY_KINDS : DOCUMENT_KINDS).map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          {library && (
            <p className="text-[11px] text-muted">
              The library holds manufacturers’ documents: manuals, service manuals and firmware notes. Books and other reference material go in as private documents.
            </p>
          )}
          <button
            onClick={upload}
            disabled={!!busy || !title.trim()}
            className="rounded bg-rust px-4 py-1.5 text-white disabled:opacity-40"
          >
            {busy || 'Upload'}
          </button>
        </div>
      )}

      {match && <MatchNote match={match} library={library} />}
      {error && !match && <p className="mt-3 t-body text-rust">{error}</p>}
    </section>
  );
}

function MatchNote({ match, library }: { match: FingerprintMatch; library: boolean }) {
  if (library && match.library) {
    return match.library.visible ? (
      <p className="mt-3 t-body">
        The library already has this file.{' '}
        <Link href={`/library/${match.library.id}`} className="text-rust underline">
          Open it
        </Link>{' '}
        to pick it for your search or link it to your gear.
      </p>
    ) : (
      <p className="mt-3 t-body">Someone has already submitted this file to the library. It appears here once it is approved.</p>
    );
  }
  if (!library && match.own) {
    return (
      <p className="mt-3 t-body">
        You already have this file as{' '}
        <Link href={`/library/${match.own.id}`} className="text-rust underline">
          {match.own.title}
        </Link>
        .
      </p>
    );
  }
  return null;
}

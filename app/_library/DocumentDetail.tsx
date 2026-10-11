'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api, InlineEdit } from '@/app/_studio/controls';
import type { StudioDocument } from '@/lib/documentTypes';
import { DOCUMENT_KIND_LABEL, REVIEW_LABEL, STATE_LABEL } from '@/lib/documentTypes';
import { formatBytes, levelAtLeast } from '@/lib/studioTypes';

// One document: what it is, where it stands, and processing (REQUIREMENTS
// K-9). While processing runs, this page calls the process route one step at
// a time; leaving the page pauses it and coming back resumes it. Controls
// follow the viewer's level; the routes and the database enforce the same.

type Model = { id: number; manufacturer: string; model: string };

const RUNNING = new Set(['pending', 'processing']);

export default function DocumentDetail({
  initial,
  viewerId,
  isAdmin,
  models,
}: {
  initial: StudioDocument;
  viewerId: string;
  isAdmin: boolean;
  /** Approved catalogue models, for linking a library manual. */
  models: Model[];
}) {
  const router = useRouter();
  const [doc, setDoc] = useState(initial);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const stop = useRef(false);

  const canEdit = levelAtLeast(doc.level, 'edit');
  // As the delete policy: the owner (the administrator, for the library), or
  // the contributor of a library document not yet approved.
  const deletable = doc.level === 'owner' || (doc.library && doc.contributedBy === viewerId && doc.reviewStatus !== 'approved');

  useEffect(() => () => {
    stop.current = true;
  }, []);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setError('');
    const r = await api<{ document: StudioDocument }>(`/api/documents/${doc.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!r.ok) {
      setError(r.body.error || 'Could not save the change.');
      return false;
    }
    setDoc(r.data.document);
    return true;
  }

  async function process() {
    setError('');
    setRunning(true);
    stop.current = false;
    try {
      for (;;) {
        if (stop.current) break;
        const r = await api<{ document: StudioDocument }>(`/api/documents/${doc.id}/process`, { method: 'POST', body: '{}' });
        if (!r.ok) {
          if (r.body.deleted) {
            setError(r.body.error);
            setTimeout(() => router.push('/library'), 4000);
            return;
          }
          if (r.body.document) setDoc(r.body.document);
          if (r.status === 503 && r.body.retryAfter) {
            setError(`${r.body.error} Trying again in ${r.body.retryAfter} seconds.`);
            await new Promise((res) => setTimeout(res, r.body.retryAfter * 1000));
            setError('');
            continue;
          }
          setError(r.body.error || 'Processing stopped.');
          return;
        }
        setDoc(r.data.document);
        if (!RUNNING.has(r.data.document.state)) return;
      }
    } finally {
      setRunning(false);
    }
  }

  async function remove() {
    setError('');
    const r = await api<{ ok: true }>(`/api/documents/${doc.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setError(r.body.error || 'Could not delete.');
      return;
    }
    router.push('/library');
    router.refresh();
  }

  async function link(modelId: number, on: boolean) {
    setError('');
    const r = on
      ? await api<{ document: StudioDocument }>(`/api/documents/${doc.id}/models`, { method: 'POST', body: JSON.stringify({ modelId }) })
      : await api<{ document: StudioDocument }>(`/api/documents/${doc.id}/models?modelId=${modelId}`, { method: 'DELETE' });
    if (!r.ok) setError(r.body.error || 'Could not change the link.');
    else setDoc(r.data.document);
  }

  const total = doc.pageCount ?? 0;
  const extracting = doc.pageCount === null || doc.pagesExtracted < total;
  const progress = total ? (extracting ? doc.pagesExtracted : doc.pagesDone) / total : 0;
  const processable = canEdit && ['pending', 'processing', 'paused', 'failed'].includes(doc.state);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <p className="mb-1 text-sm">
          <Link href="/library" className="text-muted hover:text-rust">
            ← Library
          </Link>
        </p>
        <h1 className="font-serif text-2xl sm:text-3xl">
          {canEdit ? <InlineEdit value={doc.title} placeholder="Title" label="Title" textClass="text-2xl sm:text-3xl" onSave={(v) => patch({ title: v })} /> : doc.title}
        </h1>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {canEdit ? (
            <>
              <InlineEdit value={doc.manufacturer} placeholder="Manufacturer" label="Manufacturer" onSave={(v) => patch({ manufacturer: v })} />
              <InlineEdit value={doc.model} placeholder="Model" label="Model" onSave={(v) => patch({ model: v })} />
            </>
          ) : (
            (doc.manufacturer || doc.model) && <span>{[doc.manufacturer, doc.model].filter(Boolean).join(' ')}</span>
          )}
          <span>
            {DOCUMENT_KIND_LABEL[doc.kind]}
            {doc.library ? ', in the library' : ''}
          </span>
          <span>
            {doc.filename} · {formatBytes(doc.bytes)}
            {doc.pageCount !== null ? ` · ${doc.pageCount} pages` : ''}
          </span>
          {doc.library && doc.contributorName && <span>contributed by {doc.contributorName}</span>}
          {!doc.library && doc.level !== 'owner' && <span>{doc.ownerName}’s</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href={`/api/documents/${doc.id}/file`} className="rounded-md border border-line px-3 py-1 hover:border-ink">
          Download the PDF
        </a>
        {doc.library && doc.reviewStatus === 'approved' && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={doc.picked} onChange={(e) => patch({ picked: e.target.checked })} />
            Include in my searches
          </label>
        )}
      </div>

      {doc.library && (doc.reviewStatus !== 'approved' || isAdmin) && (
        <section className="text-sm">
          <h2 className="mb-2 font-medium">Review</h2>
          <p className="text-muted">
            {REVIEW_LABEL[doc.reviewStatus]}
            {doc.reviewStatus === 'submitted' && !isAdmin ? '. You can read and process it now; others see it once the administrator approves it.' : ''}
            {doc.reviewStatus === 'rejected' && !isAdmin ? '. It stays visible to you only.' : ''}
          </p>
          {isAdmin && (
            <div className="mt-2 flex gap-2">
              {doc.reviewStatus !== 'approved' && (
                <button onClick={() => patch({ reviewStatus: 'approved' })} className="rounded-md bg-rust px-3 py-1 text-white">
                  Approve
                </button>
              )}
              {doc.reviewStatus !== 'rejected' && (
                <button onClick={() => patch({ reviewStatus: 'rejected' })} className="rounded-md border border-line px-3 py-1 hover:border-ink">
                  Reject
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <section className="text-sm">
        <h2 className="mb-2 font-medium">Processing</h2>
        <p>
          {STATE_LABEL[doc.state]}
          {doc.stateDetail ? <span className="text-muted"> — {doc.stateDetail}</span> : null}
        </p>
        {total > 0 && doc.state !== 'ready' && (
          <div className="mt-2">
            <div className="h-1.5 w-full max-w-md overflow-hidden rounded bg-line">
              <div className="h-full bg-rust transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">
              {extracting ? `Text read from ${doc.pagesExtracted} of ${total} pages` : `${doc.pagesDone} of ${total} pages searchable`}
            </p>
          </div>
        )}
        {processable && (
          <div className="mt-3 flex items-center gap-3">
            {running ? (
              <button onClick={() => (stop.current = true)} className="rounded-md border border-line px-3 py-1 hover:border-ink">
                Pause
              </button>
            ) : (
              <button onClick={process} className="rounded-md bg-rust px-3 py-1 text-white">
                {doc.state === 'pending' ? 'Process' : 'Resume'}
              </button>
            )}
            {running && <span className="text-xs text-muted">Keep this page open while it runs.</span>}
          </div>
        )}
        {doc.state === 'needs_ocr' && (
          <p className="mt-2 text-muted">Scanned documents need text recognition, which Bottega does not do yet. The PDF is stored and can be downloaded.</p>
        )}
      </section>

      {doc.library && (
        <ModelLinks doc={doc} models={models} onLink={link} />
      )}

      {error && <p className="text-sm text-rust">{error}</p>}

      {deletable && <Delete onDelete={remove} />}
    </div>
  );
}

function ModelLinks({ doc, models, onLink }: { doc: StudioDocument; models: Model[]; onLink: (id: number, on: boolean) => void }) {
  const [choice, setChoice] = useState('');
  const linked = new Set(doc.models.map((m) => m.id));
  const available = models.filter((m) => !linked.has(m.id));
  return (
    <section className="text-sm">
      <h2 className="mb-2 font-medium">Gear models</h2>
      <p className="mb-2 text-muted">Every unit of a linked model has this manual.</p>
      {doc.models.length > 0 && (
        <ul className="mb-2 space-y-1">
          {doc.models.map((m) => (
            <li key={m.id} className="flex items-baseline gap-3">
              {m.manufacturer} {m.model}
              <button onClick={() => onLink(m.id, false)} className="text-xs text-muted hover:text-rust">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <div className="flex gap-2">
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className="rounded-md border border-line bg-card px-2 py-1">
            <option value="">Link to a model…</option>
            {available.map((m) => (
              <option key={m.id} value={m.id}>
                {m.manufacturer} {m.model}
              </option>
            ))}
          </select>
          <button
            disabled={!choice}
            onClick={() => {
              onLink(Number(choice), true);
              setChoice('');
            }}
            className="rounded-md border border-line px-3 py-1 hover:border-ink disabled:opacity-40"
          >
            Link
          </button>
        </div>
      )}
    </section>
  );
}

function Delete({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="border-t border-line pt-4 text-sm">
      {armed ? (
        <span className="flex items-center gap-3">
          Delete this document, its text and its file?
          <button onClick={onDelete} className="rounded-md bg-rust px-3 py-1 text-white">
            Delete
          </button>
          <button onClick={() => setArmed(false)} className="text-muted hover:text-ink">
            Cancel
          </button>
        </span>
      ) : (
        <button onClick={() => setArmed(true)} className="text-muted hover:text-rust">
          Delete document
        </button>
      )}
    </div>
  );
}

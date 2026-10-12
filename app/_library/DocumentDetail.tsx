'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api, InlineEdit } from '@/app/_studio/controls';
import { DetailGrid, MetaList, PageHeader, Section } from '@/app/_ui/layout';
import { BUTTON, BUTTON_PRIMARY, FIELD, TEXT_ACTION, TEXT_DANGER } from '@/app/_ui/styles';
import type { StudioDocument } from '@/lib/documentTypes';
import { DOCUMENT_KIND_LABEL, REVIEW_LABEL, STATE_LABEL } from '@/lib/documentTypes';
import { formatBytes, levelAtLeast } from '@/lib/studioTypes';

// One document: what it is, where it stands, and processing (REQUIREMENTS
// K-9). While processing runs, this page calls the process route one step at
// a time; leaving the page pauses it and coming back resumes it. Controls
// follow the viewer's level; the routes and the database enforce the same.

type Model = { id: number; manufacturer: string; model: string };
type Group = { id: number; name: string; shared: boolean };

const RUNNING = new Set(['pending', 'processing']);

export default function DocumentDetail({
  initial,
  viewerId,
  isAdmin,
  models,
  groups: initialGroups = [],
}: {
  initial: StudioDocument;
  viewerId: string;
  isAdmin: boolean;
  /** Approved catalogue models, for linking a library manual. */
  models: Model[];
  /** For the owner of a private document: their study groups, and which it is shared with (db/016). */
  groups?: Group[];
}) {
  const router = useRouter();
  const [doc, setDoc] = useState(initial);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [groups, setGroups] = useState(initialGroups);
  const stop = useRef(false);

  const canEdit = levelAtLeast(doc.level, 'edit');
  // As the delete policy: the owner (the administrator, for the library), or
  // the contributor of a library document not yet approved.
  const deletable = doc.level === 'owner' || (doc.library && doc.contributedBy === viewerId && doc.reviewStatus !== 'approved');

  useEffect(() => () => {
    stop.current = true;
  }, []);

  async function shareWithGroup(groupId: number, share: boolean) {
    setError('');
    const r = await api<{ groups: Group[] }>(`/api/documents/${doc.id}/groups`, { method: share ? 'POST' : 'DELETE', body: JSON.stringify({ groupId }) });
    if (!r.ok) return setError(r.body.error || 'Could not change the sharing.');
    setGroups(r.data.groups);
  }

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

  const main = (
    <>
      <Section label="Processing">
        <div className="t-body">
          <p>
            {STATE_LABEL[doc.state]}
            {doc.stateDetail ? <span className="text-muted"> — {doc.stateDetail}</span> : null}
          </p>
          {total > 0 && doc.state !== 'ready' && (
            <div className="mt-2">
              <div className="h-1.5 w-full max-w-md overflow-hidden rounded bg-line">
                <div className="h-full bg-rust transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {extracting ? `Text read from ${doc.pagesExtracted} of ${total} pages` : `${doc.pagesDone} of ${total} pages searchable`}
              </p>
            </div>
          )}
          {processable && (
            <div className="mt-3 flex items-center gap-3">
              {running ? (
                <button onClick={() => (stop.current = true)} className={BUTTON}>
                  Pause
                </button>
              ) : (
                <button onClick={process} className={BUTTON_PRIMARY}>
                  {doc.state === 'pending' ? 'Process' : 'Resume'}
                </button>
              )}
              {running && <span className="text-[11px] text-muted">Keep this page open while it runs.</span>}
            </div>
          )}
          {doc.state === 'needs_ocr' && (
            <p className="mt-2 text-muted">Scanned documents need text recognition, which Bottega does not do yet. The PDF is stored and can be downloaded.</p>
          )}
        </div>
      </Section>

      {doc.library && <ModelLinks doc={doc} models={models} onLink={link} />}

      {doc.library && (doc.reviewStatus !== 'approved' || isAdmin) && (
        <Section label="Review">
          <div className="t-body">
            <p className="text-muted">
              {REVIEW_LABEL[doc.reviewStatus]}
              {doc.reviewStatus === 'submitted' && !isAdmin ? '. You can read and process it now; others see it once the administrator approves it.' : ''}
              {doc.reviewStatus === 'rejected' && !isAdmin ? '. It stays visible to you only.' : ''}
            </p>
            {isAdmin && (
              <div className="mt-2 flex gap-2">
                {doc.reviewStatus !== 'approved' && (
                  <button onClick={() => patch({ reviewStatus: 'approved' })} className={BUTTON_PRIMARY}>
                    Approve
                  </button>
                )}
                {doc.reviewStatus !== 'rejected' && (
                  <button onClick={() => patch({ reviewStatus: 'rejected' })} className={BUTTON}>
                    Reject
                  </button>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {error && <p className="t-body mb-4 text-rust">{error}</p>}
      {deletable && <Delete onDelete={remove} />}
    </>
  );

  const aside = (
    <>
      <Section label="Details">
        <MetaList
          rows={[
            {
              label: 'Manufacturer',
              value: canEdit ? (
                <InlineEdit value={doc.manufacturer} placeholder="—" label="Manufacturer" textClass="t-body" onSave={(v) => patch({ manufacturer: v })} />
              ) : (
                doc.manufacturer || '—'
              ),
            },
            {
              label: 'Model',
              value: canEdit ? (
                <InlineEdit value={doc.model} placeholder="—" label="Model" textClass="t-body" onSave={(v) => patch({ model: v })} />
              ) : (
                doc.model || '—'
              ),
            },
            { label: 'Kind', value: DOCUMENT_KIND_LABEL[doc.kind] },
            { label: 'Where', value: doc.library ? 'The library' : doc.level === 'owner' ? 'Yours, private' : `${doc.ownerName}’s, private` },
            ...(doc.library && doc.contributorName ? [{ label: 'Contributed', value: doc.contributorName }] : []),
            {
              label: 'File',
              value: (
                <span className="break-all">
                  {doc.filename} <span className="t-num text-muted">· {formatBytes(doc.bytes)}</span>
                </span>
              ),
            },
            ...(doc.pageCount !== null ? [{ label: 'Pages', value: <span className="t-num">{doc.pageCount}</span> }] : []),
          ]}
        />
      </Section>
      {!doc.library && doc.level === 'owner' && groups.length > 0 && (
        <Section label="Study groups">
          <ul className="t-body space-y-1">
            {groups.map((g) => (
              <li key={g.id}>
                <label className="flex items-baseline gap-2">
                  <input type="checkbox" checked={g.shared} onChange={(e) => shareWithGroup(g.id, e.target.checked)} />
                  <span>{g.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted">A group’s members can read a document shared with it, and its lessons’ citations link to it, for as long as they are members.</p>
        </Section>
      )}
    </>
  );

  return (
    <div>
      <PageHeader
        back={{ href: '/library', label: 'Library' }}
        title={canEdit ? <InlineEdit value={doc.title} placeholder="Title" label="Title" textClass="t-title" onSave={(v) => patch({ title: v })} /> : doc.title}
        meta={[
          [doc.manufacturer, doc.model].filter(Boolean).join(' ') || null,
          DOCUMENT_KIND_LABEL[doc.kind],
          doc.pageCount !== null ? `${doc.pageCount} pages` : null,
        ]}
        actions={
          <>
            {doc.pagesExtracted > 0 && (
              <Link href={`/library/${doc.id}/read?page=1`} className={TEXT_ACTION}>
                Read the pages
              </Link>
            )}
            {doc.library && doc.reviewStatus === 'approved' && (
              <label className="flex items-center gap-1.5 text-muted">
                <input type="checkbox" checked={doc.picked} onChange={(e) => patch({ picked: e.target.checked })} />
                Include in my searches
              </label>
            )}
            <a href={`/api/documents/${doc.id}/file`} className={BUTTON}>
              Download the PDF
            </a>
          </>
        }
      />
      <DetailGrid main={main} aside={aside} />
    </div>
  );
}

function ModelLinks({ doc, models, onLink }: { doc: StudioDocument; models: Model[]; onLink: (id: number, on: boolean) => void }) {
  const [choice, setChoice] = useState('');
  const linked = new Set(doc.models.map((m) => m.id));
  const available = models.filter((m) => !linked.has(m.id));
  return (
    <Section label="Gear models">
      <div className="t-body">
      <p className="mb-2 text-muted">Every unit of a linked model has this manual.</p>
      {doc.models.length > 0 && (
        <ul className="mb-2 space-y-1">
          {doc.models.map((m) => (
            <li key={m.id} className="flex items-baseline gap-3">
              {m.manufacturer} {m.model}
              <button onClick={() => onLink(m.id, false)} className={`text-[11px] ${TEXT_DANGER}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        <div className="flex gap-2">
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className={FIELD}>
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
            className={BUTTON}
          >
            Link
          </button>
        </div>
      )}
      </div>
    </Section>
  );
}

function Delete({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="t-body mt-10 border-t border-line pt-3">
      {armed ? (
        <span className="flex items-center gap-3">
          Delete this document, its text and its file?
          <button onClick={onDelete} className={BUTTON_PRIMARY}>
            Delete
          </button>
          <button onClick={() => setArmed(false)} className={TEXT_ACTION}>
            Cancel
          </button>
        </span>
      ) : (
        <button onClick={() => setArmed(true)} className={TEXT_DANGER}>
          Delete document
        </button>
      )}
    </div>
  );
}

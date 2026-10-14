'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api, InlineEdit } from '@/app/_studio/controls';
import { DetailGrid, MetaList, PageHeader, Section } from '@/app/_ui/layout';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY, FIELD, TEXT_LINK } from '@/app/_ui/styles';
import type { StudioDocument } from '@/lib/documentTypes';
import { DOCUMENT_KIND_LABEL, DOCUMENT_KINDS, LIBRARY_KINDS, REVIEW_LABEL, STATE_LABEL, type DocumentKind } from '@/lib/documentTypes';
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
  structure = null,
}: {
  initial: StudioDocument;
  viewerId: string;
  isAdmin: boolean;
  /** Approved catalogue models, for linking a library manual. */
  models: Model[];
  /** Study groups whose reading list the viewer may change for this document, and whether it is on each (db/016, 019). */
  groups?: Group[];
  /** Printed page numbers and contents (db/022), once text has been read. */
  structure?: { labelled: number; hand: number; sections: number } | null;
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

  async function moveHome(toLibrary: boolean, kind: DocumentKind) {
    setError('');
    const r = await api<{ document: StudioDocument | null; gone: boolean }>(`/api/documents/${doc.id}`, {
      method: 'POST',
      body: JSON.stringify({ op: 'move', library: toLibrary, kind }),
    });
    if (!r.ok) return setError(r.body.error || 'Could not move the document.');
    if (r.data.gone || !r.data.document) return router.push('/library');
    setDoc(r.data.document);
    router.refresh();
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
      {structure && <PagesAndContents doc={doc} structure={structure} canEdit={canEdit} onDone={() => router.refresh()} setError={setError} />}
    {isAdmin && <MoveHome key={String(doc.library)} doc={doc} onMove={moveHome} />}
    {groups.length > 0 && ((!doc.library && doc.level === 'owner') || (doc.library && doc.reviewStatus === 'approved')) && (
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
          <p className="mt-1 text-[11px] text-muted">
          {doc.library
            ? 'On a group’s reading list, Claude searches it when working on that group. You keep these groups as custodian.'
            : 'On a group’s reading list, every member can read it for as long as they are members, and Claude searches it when working on that group.'}
        </p>
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
              <Link href={`/library/${doc.id}/read?page=1`} className={TEXT_LINK}>
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
              <button onClick={() => onLink(m.id, false)} className={BUTTON_DANGER}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 && (
        // Choosing a model links it at once; Remove above undoes it.
        <select
          value=""
          onChange={(e) => e.target.value && onLink(Number(e.target.value), true)}
          aria-label="Link to a model"
          className={FIELD}
        >
          <option value="">{doc.models.length ? 'Link another model…' : 'Link to a model…'}</option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.manufacturer} {m.model}
            </option>
          ))}
        </select>
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
          <button onClick={() => setArmed(false)} className={BUTTON}>
            Cancel
          </button>
        </span>
      ) : (
        <button onClick={() => setArmed(true)} className={BUTTON_DANGER}>
          Delete document
        </button>
      )}
    </div>
  );
}

/**
 * The platform administrator moves a document between the library and private
 * documents (db/018). Library to private: it goes to its contributor, and
 * picks and model links are removed. Private to library: it is approved, its
 * former owner kept as contributor, and its shares removed. Pages stay.
 */
function MoveHome({ doc, onMove }: { doc: StudioDocument; onMove: (toLibrary: boolean, kind: DocumentKind) => void }) {
  const toLibrary = !doc.library;
  const kinds = toLibrary ? LIBRARY_KINDS : DOCUMENT_KINDS;
  const [kind, setKind] = useState<DocumentKind>(kinds.includes(doc.kind) ? doc.kind : toLibrary ? 'manual' : 'book');
  const [asking, setAsking] = useState(false);
  const who = doc.library ? doc.contributorName || 'you' : doc.ownerName || 'its owner';
  return (
    <Section label="Where it lives">
      <p className="t-body mb-2">
        {doc.library ? 'In the library.' : `Private to ${doc.level === 'owner' ? 'you' : doc.ownerName}.`}
      </p>
      {!asking ? (
        <button onClick={() => setAsking(true)} className={BUTTON}>
          {toLibrary ? 'Move to the library…' : `Make it private to ${who}…`}
        </button>
      ) : (
        <div className="t-body space-y-2">
          <p className="text-[11px] text-muted">
            {toLibrary
              ? `Every account will read it, approved; ${who} stays its contributor. Its shares with people and study groups are removed.`
              : `It becomes ${who}’s private document. Picks by other accounts and links to catalogue models are removed.`}{' '}
            Its pages stay; nothing is processed again. The move is logged.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} aria-label="Kind" className={FIELD}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <button onClick={() => onMove(toLibrary, kind)} className={`self-stretch ${BUTTON}`}>
              Move
            </button>
            <button onClick={() => setAsking(false)} className={`self-stretch ${BUTTON}`}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

/**
 * Printed page numbers and the PDF's contents (db/022). Read from the PDF
 * when it is processed; read again here for a document processed before; and
 * printed numbers set by hand for a range of pages, for a PDF without its own.
 */
function PagesAndContents({
  doc,
  structure,
  canEdit,
  onDone,
  setError,
}: {
  doc: StudioDocument;
  structure: { labelled: number; hand: number; sections: number };
  canEdit: boolean;
  onDone: () => void;
  setError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(doc.pageCount ? String(doc.pageCount) : '');
  const [first, setFirst] = useState('1');
  const [style, setStyle] = useState<'arabic' | 'roman' | 'none'>('arabic');

  async function post(body: Record<string, unknown>) {
    setError('');
    setBusy(true);
    const r = await api(`/api/documents/${doc.id}`, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) return setError(r.body.error || 'That did not go through.');
    onDone();
  }

  return (
    <Section label="Pages and contents">
      <p className="t-body">
        {structure.labelled
          ? `${structure.labelled} pages carry a printed number${structure.hand ? ` (${structure.hand} set by hand)` : ''}.`
          : 'No printed page numbers: pages are cited by their place in the PDF.'}{' '}
        {structure.sections ? `The contents has ${structure.sections} entries.` : 'No contents (the PDF has no bookmarks, or they have not been read).'}
      </p>
      {canEdit && (
        <>
          <button onClick={() => post({ op: 'contents' })} disabled={busy} className={`mt-2 ${BUTTON}`}>
            {busy ? 'Reading…' : 'Read page numbers and contents from the PDF'}
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              post({ op: 'labels', from, to, first: style === 'none' ? null : first, style });
            }}
            className="t-body mt-3 space-y-2"
          >
            <p className="t-label">Set printed numbers by hand</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span>PDF pages</span>
              <input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" placeholder="13" aria-label="From PDF page" className={`${FIELD} t-num w-16`} />
              <span>to</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" aria-label="To PDF page" className={`${FIELD} t-num w-16`} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select value={style} onChange={(e) => setStyle(e.target.value as 'arabic' | 'roman' | 'none')} aria-label="Numerals" className={FIELD}>
                <option value="arabic">are printed 1, 2, 3…</option>
                <option value="roman">are printed i, ii, iii…</option>
                <option value="none">clear what was set by hand</option>
              </select>
              {style !== 'none' && (
                <>
                  <span>starting at</span>
                  <input value={first} onChange={(e) => setFirst(e.target.value)} inputMode="numeric" aria-label="First printed number" className={`${FIELD} t-num w-16`} />
                </>
              )}
              <button disabled={busy || !from || !to} className={`self-stretch ${BUTTON}`}>
                Set
              </button>
            </div>
            <p className="text-[11px] text-muted">
              Check one page in the reader: if PDF page 824 shows 812 at its foot, the range starting at PDF page 13 is printed from 1.
            </p>
          </form>
        </>
      )}
    </Section>
  );
}

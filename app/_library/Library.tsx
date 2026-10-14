'use client';

import Link from 'next/link';
import { useState } from 'react';

import Upload from '@/app/_library/Upload';
import { PageHeader, TabBar } from '@/app/_ui/layout';
import { BUTTON, BUTTON_PRIMARY, FIELD } from '@/app/_ui/styles';
import type { Allowance, StudioDocument } from '@/lib/documentTypes';
import { DOCUMENT_KIND_LABEL, REVIEW_LABEL, STATE_LABEL } from '@/lib/documentTypes';
import { GEAR_GROUPS, groupOfModel, type GearGroup } from '@/lib/gearGroups';
import { formatBytes } from '@/lib/studioTypes';

// The library and the person's own documents (REQUIREMENTS §8), in tabs:
//
//   Library         approved library manuals, by type, then manufacturer, then
//                   model. A manual's type is its catalogue model's group, the
//                   same groups as the gear map (lib/gearGroups.ts), so nothing
//                   is filed twice; a manual linked to two models is under
//                   both. A manual with no catalogue model is under Not filed,
//                   by the manufacturer and model typed on it, until someone
//                   links it on its page.
//   Your documents  private documents the viewer owns, by title
//   Shared          private documents shared with the viewer
//   Submissions     the viewer's library uploads not yet approved, and for the
//                   administrator, others' uploads awaiting review
//
// Tab, type and manufacturer are kept in the address with
// history.replaceState (?tab=&type=&maker=), as on the session and group
// pages, so a link opens the same view and switching does not reload. Adding
// documents (Upload.tsx) opens from the header. The routes and the database
// enforce every rule shown.

const TABS = ['library', 'mine', 'shared', 'submissions'] as const;
type LibraryTab = (typeof TABS)[number];
const TAB_LABEL: Record<LibraryTab, string> = { library: 'Library', mine: 'Your documents', shared: 'Shared', submissions: 'Submissions' };

type Shelf = GearGroup | 'unfiled';
type ShelfChoice = Shelf | 'all';
const SHELVES: { key: ShelfChoice; label: string }[] = [
  { key: 'all', label: 'All' },
  ...GEAR_GROUPS.map((g) => ({ key: g.key as ShelfChoice, label: g.label })),
  { key: 'unfiled', label: 'Not filed' },
];

/** One place a document stands on the shelves: under a manufacturer and model, in a type. */
type Entry = { shelf: Shelf; maker: string; model: string; doc: StudioDocument };

function entriesOf(docs: StudioDocument[]): Entry[] {
  const linked = docs.flatMap((d) =>
    d.models.map((m): Entry => ({ shelf: groupOfModel(m), maker: m.manufacturer.trim(), model: m.model.trim(), doc: d })),
  );
  const unlinked = docs
    .filter((d) => !d.models.length)
    .map((d): Entry => ({ shelf: 'unfiled', maker: d.manufacturer.trim(), model: d.model.trim(), doc: d }));
  // One spelling per manufacturer, ignoring case ("SOMA" and "Soma" are one
  // row): the catalogue's where it has one, else the first typed.
  const spelling = new Map<string, string>();
  for (const e of [...linked, ...unlinked]) if (!spelling.has(e.maker.toLowerCase())) spelling.set(e.maker.toLowerCase(), e.maker);
  return [...linked, ...unlinked].map((e) => ({ ...e, maker: spelling.get(e.maker.toLowerCase()) ?? e.maker }));
}

/** Alphabetical, ignoring case and accents, numbers by value (TD-3 before TD-10); blank last. */
function byName(a: string, b: string): number {
  if (!a !== !b) return a ? -1 : 1;
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

const distinct = (es: Entry[]) => new Set(es.map((e) => e.doc.id)).size;

export default function Library({
  documents,
  allowance,
  viewerId,
  isAdmin,
  initial,
}: {
  documents: StudioDocument[];
  allowance: Allowance | null;
  viewerId: string;
  isAdmin: boolean;
  /** From the address, unchecked. */
  initial: { tab: string; type: string; maker: string };
}) {
  const mine = documents.filter((d) => !d.library && d.ownerId === viewerId).sort((a, b) => byName(a.title, b.title));
  const shared = documents.filter((d) => !d.library && d.ownerId !== viewerId).sort((a, b) => byName(a.title, b.title));
  const submissions = documents.filter((d) => d.library && d.contributedBy === viewerId && d.reviewStatus !== 'approved');
  const queue = isAdmin ? documents.filter((d) => d.library && d.reviewStatus === 'submitted' && d.contributedBy !== viewerId) : [];
  const library = documents.filter((d) => d.library && d.reviewStatus === 'approved');

  const [tab, setTab] = useState<LibraryTab>((TABS as readonly string[]).includes(initial.tab) ? (initial.tab as LibraryTab) : 'library');
  const [shelf, setShelf] = useState<ShelfChoice>(SHELVES.some((s) => s.key === initial.type) ? (initial.type as ShelfChoice) : 'all');
  const [maker, setMaker] = useState(initial.maker);
  const [adding, setAdding] = useState(false);

  /** Keep the view in the address; a default is left out. */
  function remember(next: { tab: LibraryTab; shelf: ShelfChoice; maker: string }) {
    const url = new URL(window.location.href);
    const set = (k: string, v: string, fallback: string) => (v && v !== fallback ? url.searchParams.set(k, v) : url.searchParams.delete(k));
    set('tab', next.tab, 'library');
    set('type', next.tab === 'library' ? next.shelf : '', 'all');
    set('maker', next.tab === 'library' ? next.maker : '', '');
    window.history.replaceState(null, '', url);
  }

  function selectTab(key: string) {
    const next = key as LibraryTab;
    setTab(next);
    remember({ tab: next, shelf, maker });
  }

  const tabs = [
    { key: 'library', label: TAB_LABEL.library, count: library.length },
    { key: 'mine', label: TAB_LABEL.mine, count: mine.length },
    ...(shared.length || tab === 'shared' ? [{ key: 'shared', label: TAB_LABEL.shared, count: shared.length }] : []),
    ...(submissions.length || queue.length || tab === 'submissions'
      ? [{ key: 'submissions', label: queue.length ? 'Submissions · to review' : TAB_LABEL.submissions, count: submissions.length + queue.length }]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Library"
        actions={
          <>
            <form action="/library/search" method="get" className="flex">
              <input name="q" placeholder="Search the manuals and books" aria-label="Search" className={`${FIELD} w-64`} />
            </form>
            <button type="button" onClick={() => setAdding(!adding)} className={adding ? BUTTON : BUTTON_PRIMARY} aria-expanded={adding}>
              {adding ? 'Close' : 'Add documents'}
            </button>
          </>
        }
      />
      {allowance && <AllowanceLine a={allowance} />}
      {adding && (
        <div className="mb-8">
          <Upload />
        </div>
      )}
      <div className="mb-6 border-b border-line">
        <TabBar tabs={tabs} current={tab} onSelect={selectTab} />
      </div>
      {tab === 'library' && (
        <Shelves
          docs={library}
          shelf={shelf}
          maker={maker}
          onShelf={(s) => {
            setShelf(s);
            remember({ tab, shelf: s, maker });
          }}
          onMaker={(m) => {
            setMaker(m);
            remember({ tab, shelf, maker: m });
          }}
        />
      )}
      {tab === 'mine' && <DocList docs={mine} about empty="Nothing private yet. Books and anything not for the library go here: Add documents, then Private." />}
      {tab === 'shared' && <DocList docs={shared} about empty="Nothing has been shared with you." />}
      {tab === 'submissions' && (
        <div className="space-y-10">
          {isAdmin && (
            <Group title="Awaiting your review">
              <DocList docs={queue} about empty="Nobody else’s uploads are waiting." />
            </Group>
          )}
          <Group title="Your submissions">
            <DocList docs={submissions} about empty="Nothing of yours is waiting. Library uploads wait here until the administrator approves them." />
          </Group>
        </div>
      )}
    </div>
  );
}

/** The Library tab: types along the top; manufacturers on the left; the chosen one's models and manuals on the right. */
function Shelves({
  docs,
  shelf,
  maker,
  onShelf,
  onMaker,
}: {
  docs: StudioDocument[];
  shelf: ShelfChoice;
  maker: string;
  onShelf: (s: ShelfChoice) => void;
  onMaker: (m: string) => void;
}) {
  const all = entriesOf(docs);
  const onShelfEntries = shelf === 'all' ? all : all.filter((e) => e.shelf === shelf);
  // Types with nothing in them are left out, except the one chosen.
  const shelves = SHELVES.map((s) => ({ ...s, count: distinct(s.key === 'all' ? all : all.filter((e) => e.shelf === s.key)) })).filter(
    (s) => s.count > 0 || s.key === shelf || s.key === 'all',
  );

  const makers = Array.from(new Set(onShelfEntries.map((e) => e.maker))).sort(byName);
  // The chosen manufacturer, if this type has it; otherwise the first.
  const current = makers.find((m) => m.toLowerCase() === maker.toLowerCase()) ?? makers[0];
  const here = onShelfEntries.filter((e) => e.maker === current);
  const models = Array.from(new Set(here.map((e) => e.model))).sort(byName);
  const makerLabel = (m: string) => m || 'No manufacturer';

  return (
    <div>
      <nav className="t-body mb-6 flex flex-wrap gap-x-5 gap-y-2" aria-label="Types">
        {shelves.map((s) => {
          const on = s.key === shelf;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onShelf(s.key)}
              aria-current={on ? 'true' : undefined}
              className={on ? 'text-ink underline decoration-2 underline-offset-[6px]' : 'text-muted hover:text-ink'}
            >
              {s.label}
              {s.count > 0 && <span className="t-num ml-1.5 text-[11px] text-muted">{s.count}</span>}
            </button>
          );
        })}
      </nav>
      {makers.length === 0 ? (
        <p className="t-body text-muted">
          {docs.length === 0 ? 'The library is empty. Add documents, then Library, to start it.' : 'Nothing of this type yet.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-[14rem_minmax(0,1fr)]">
          <div>
            <select value={current} onChange={(e) => onMaker(e.target.value)} className={`${FIELD} w-full md:hidden`} aria-label="Manufacturer">
              {makers.map((m) => (
                <option key={m} value={m}>
                  {makerLabel(m)} ({distinct(onShelfEntries.filter((e) => e.maker === m))})
                </option>
              ))}
            </select>
            <ul className="t-body hidden border-y border-line md:block md:max-h-[70vh] md:overflow-y-auto" aria-label="Manufacturers">
              {makers.map((m) => {
                const on = m === current;
                return (
                  <li key={m}>
                    <button
                      type="button"
                      onClick={() => onMaker(m)}
                      aria-current={on ? 'true' : undefined}
                      className={`flex w-full items-baseline gap-2 px-2 py-1 text-left ${on ? 'bg-ink/5 text-ink' : 'text-muted hover:text-ink'}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{makerLabel(m)}</span>
                      <span className="t-num text-[11px] text-muted">{distinct(onShelfEntries.filter((e) => e.maker === m))}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="min-w-0">
            <h2 className="t-lead mb-4">{makerLabel(current)}</h2>
            <div className="space-y-6">
              {models.map((model) => (
                <section key={model}>
                  <h3 className="t-body mb-1 font-medium">{model || 'Model not named'}</h3>
                  <DocList docs={here.filter((e) => e.model === model).map((e) => e.doc).sort((a, b) => byName(a.title, b.title))} />
                </section>
              ))}
            </div>
            {shelf === 'unfiled' && (
              <p className="mt-6 text-[11px] text-muted">
                These manuals have no catalogue model yet, so they have no type. Choosing a gear model on a manual&rsquo;s page files it.
              </p>
            )}
          </div>
        </div>
      )}
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
  return <p className="-mt-3 mb-6 text-[11px] text-muted">{parts.join(' · ')}</p>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="t-label mb-3 border-b border-line pb-1">{title}</h2>
      {children}
    </section>
  );
}

/** Documents as rows: title, what it is about (where the list does not already say), kind, state. */
function DocList({ docs, about = false, empty }: { docs: StudioDocument[]; about?: boolean; empty?: string }) {
  if (docs.length === 0) return <p className="t-body text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line border-y border-line">
      {docs.map((d) => (
        <li key={d.id} className="t-body flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
          <Link href={`/library/${d.id}`} className="font-medium hover:text-rust">
            {d.title}
          </Link>
          {about && (d.manufacturer || d.model) && <span className="text-muted">{[d.manufacturer, d.model].filter(Boolean).join(' ')}</span>}
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
  );
}

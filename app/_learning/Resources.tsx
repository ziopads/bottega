'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';

import type { Call } from '@/app/_learning/Exercise';
import { NoteItem } from '@/app/_learning/Journal';
import { titlesOf } from '@/app/_learning/LessonBody';
import VideoPlayer, { type VideoHandle } from '@/app/_learning/VideoPlayer';
import { api } from '@/app/_studio/controls';
import { DetailGrid, PageHeader, Section } from '@/app/_ui/layout';
import { BUTTON, BUTTON_PRIMARY, FIELD, TEXT_ACTION, TEXT_DANGER } from '@/app/_ui/styles';
import { resourceHref, tabHref, type StudyGroup, type StudyResource } from '@/lib/studyTypes';
import { formatTime, parseTime } from '@/lib/youtube';

// A study group's videos and links (REQUIREMENTS L-23, db/020): on the
// Resources tab, grouped by the topics they are filed under ("Not filed"
// last), with Claude's drafts at the top for the member they were added for;
// and the watch page, with the video played in the app and the notes on it
// listed by moment. "Note at 4:32" takes the moment from the player; a
// note's moment jumps the player there.

function Thumb({ r, size = 'md' }: { r: StudyResource; size?: 'md' | 'sm' }) {
  const box = size === 'md' ? 'h-[72px] w-32' : 'h-12 w-20';
  return r.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={r.thumbnailUrl} alt="" className={`${box} shrink-0 rounded object-cover`} loading="lazy" />
  ) : (
    <span className={`${box} t-label flex shrink-0 items-center justify-center rounded border border-line text-muted`}>
      {r.kind === 'video' ? 'Video' : 'Link'}
    </span>
  );
}

function ResourceRow({ r, g, viewerId, call, busy }: { r: StudyResource; g: StudyGroup; viewerId: string; call: Call; busy: boolean }) {
  const notes = g.notes.filter((n) => n.resourceId === r.id).length;
  const mine = r.addedById === viewerId && g.status === 'open';
  return (
    <li className="flex gap-3 py-2">
      <Link href={resourceHref(g.id, r.id)} className="shrink-0">
        <Thumb r={r} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={resourceHref(g.id, r.id)} className="t-lead hover:text-rust">
          {r.title}
        </Link>
        <p className="text-[11px] text-muted">
          {[r.channel, `added by ${r.addedByName}`, notes ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : null, r.origin === 'assistant' ? 'added by Claude' : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {r.why && <p className="t-body mt-0.5">{r.why}</p>}
        {!r.published && mine && (
          <span className="mt-1 flex gap-3 text-[11px]">
            <button onClick={() => call(`/api/study/resources/${r.id}`, 'POST', { op: 'publish' })} disabled={busy} className={BUTTON_PRIMARY}>
              Publish
            </button>
            <button onClick={() => call(`/api/study/resources/${r.id}`, 'DELETE')} disabled={busy} className={TEXT_DANGER}>
              Discard
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

function AddResource({ g, call, busy, onDone }: { g: StudyGroup; call: Call; busy: boolean; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const [topicIds, setTopicIds] = useState<number[]>([]);
  const topics = g.topics.filter((t) => t.review === 'accepted');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await call(`/api/study/groups/${g.id}`, 'POST', { op: 'resource', url, title, why, topicIds })) onDone();
      }}
      className="t-body mb-4 max-w-prose space-y-2"
    >
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="A YouTube link, or any https:// address"
        aria-label="Address"
        className={`${FIELD} w-full`}
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (a YouTube video brings its own)"
        aria-label="Title"
        className={`${FIELD} w-full`}
      />
      <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="Why it is worth the time (optional)" aria-label="Why" className={`${FIELD} w-full`} />
      {topics.length > 0 && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="t-label mb-1">File under</legend>
          {topics.map((t) => (
            <label key={t.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={topicIds.includes(t.id)}
                onChange={(e) => setTopicIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))}
              />
              {t.title}
            </label>
          ))}
        </fieldset>
      )}
      <span className="flex gap-3">
        <button disabled={busy || !url.trim()} className={BUTTON}>
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button type="button" onClick={onDone} className={TEXT_ACTION}>
          Cancel
        </button>
      </span>
    </form>
  );
}

/** The Resources tab's videos and links, above the reading list. */
export function VideosSection({ g, viewerId, call, busy }: { g: StudyGroup; viewerId: string; call: Call; busy: boolean }) {
  const [adding, setAdding] = useState(false);
  const drafts = g.resources.filter((r) => !r.published && r.addedById === viewerId);
  const published = g.resources.filter((r) => r.published);
  const topics = g.topics.filter((t) => t.review === 'accepted');
  const groups = [
    ...topics.map((t) => ({ key: `t${t.id}`, label: t.title, items: published.filter((r) => r.topicIds.includes(t.id)) })),
    { key: 'none', label: 'Not filed', items: published.filter((r) => !r.topicIds.some((id) => topics.some((t) => t.id === id))) },
  ].filter((x) => x.items.length);

  return (
    <>
      {drafts.length > 0 && (
        <div className="t-body mb-6 rounded border border-line bg-card px-3 py-2">
          <p className="t-label mb-1">Added by Claude for you · seen only by you until you publish</p>
          <ul className="divide-y divide-line">
            {drafts.map((r) => (
              <ResourceRow key={r.id} r={r} g={g} viewerId={viewerId} call={call} busy={busy} />
            ))}
          </ul>
        </div>
      )}
      <Section
        label="Videos and links"
        action={g.status === 'open' && !adding ? <button onClick={() => setAdding(true)} className={TEXT_ACTION}>+ Add</button> : undefined}
      >
        {adding && <AddResource g={g} call={call} busy={busy} onDone={() => setAdding(false)} />}
        {groups.length === 0 ? (
          <p className="t-body max-w-prose text-muted">
            None yet. Paste a YouTube link: it plays here, and notes can point at moments in it.
          </p>
        ) : (
          groups.map((x) => (
            <div key={x.key} className="mb-4">
              <p className="t-label mb-1">{x.label}</p>
              <ul className="divide-y divide-line border-y border-line">
                {x.items.map((r) => (
                  <ResourceRow key={r.id} r={r} g={g} viewerId={viewerId} call={call} busy={busy} />
                ))}
              </ul>
            </div>
          ))
        )}
      </Section>
    </>
  );
}

// ── The watch page ───────────────────────────────────────────────────────────

export default function ResourceView({
  initial,
  resourceId,
  viewerId,
  start,
}: {
  initial: StudyGroup;
  resourceId: number;
  viewerId: string;
  start: number | null;
}) {
  const [g, setG] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const player = useRef<VideoHandle>(null);
  const titles = useMemo(() => titlesOf(g.documents), [g.documents]);

  const call: Call = async (url, method, body) => {
    setError('');
    setBusy(true);
    const r = await api<{ group: StudyGroup }>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'That did not go through.');
      return false;
    }
    if (r.data.group) setG(r.data.group);
    return true;
  };

  const r = g.resources.find((x) => x.id === resourceId);
  if (!r) {
    return (
      <p className="t-body text-muted">
        This resource is no longer in the group. <Link href={tabHref(g.id, 'resources')}>Back to {g.name}</Link>
      </p>
    );
  }
  const open = g.status === 'open';
  const mine = r.addedById === viewerId && open;
  const mayRemove = (r.addedById === viewerId || g.custodianId === viewerId) && open;
  const notes = g.notes
    .filter((n) => n.resourceId === r.id && (n.published || n.authorId === viewerId))
    .slice()
    .sort((a, b) => (a.positionS ?? Infinity) - (b.positionS ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
  const topicNames = r.topicIds.map((id) => g.topics.find((t) => t.id === id)?.title).filter(Boolean);

  const main = (
    <>
      {r.kind === 'video' && r.youtubeId ? (
        <VideoPlayer ref={player} videoId={r.youtubeId} start={start} title={r.title} />
      ) : (
        <p className="t-body">
          <a href={r.url} target="_blank" rel="noreferrer" className="text-rust hover:underline">
            Open the page
          </a>{' '}
          <span className="text-muted">({new URL(r.url).hostname})</span>
        </p>
      )}
      {r.why && <p className="t-body mt-3 max-w-prose">{r.why}</p>}
      {!r.published && mine && (
        <p className="t-body mt-3 flex items-center gap-3 rounded border border-line bg-card px-3 py-2">
          Added by Claude for you; only you see it.
          <button onClick={() => call(`/api/study/resources/${r.id}`, 'POST', { op: 'publish' })} disabled={busy} className={BUTTON_PRIMARY}>
            Publish
          </button>
        </p>
      )}
      {mine && <EditResource r={r} g={g} call={call} busy={busy} />}
      {error && <p className="t-body mt-3 text-rust">{error}</p>}
    </>
  );

  const aside = (
    <Section label={r.kind === 'video' ? 'Notes at moments' : 'Notes'}>
      {notes.length === 0 && <p className="t-body mb-3 text-muted">None yet.</p>}
      {notes.length > 0 && (
        <ul className="mb-3 divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-2">
              {n.positionS !== null && r.kind === 'video' && (
                <button onClick={() => player.current?.seek(n.positionS!)} className="t-num mt-2 shrink-0 self-start text-[12px] text-rust hover:underline">
                  {formatTime(n.positionS)}
                </button>
              )}
              <ul className="min-w-0 flex-1">
                <NoteItem n={n} g={g} viewerId={viewerId} titles={titles} call={call} busy={busy} showContext={false} />
              </ul>
            </li>
          ))}
        </ul>
      )}
      {open && <MomentNote g={g} r={r} player={player} call={call} busy={busy} />}
    </Section>
  );

  return (
    <div>
      <PageHeader
        back={{ href: tabHref(g.id, 'resources'), label: g.name }}
        title={r.title}
        meta={[r.channel || null, `added by ${r.addedByName}`, topicNames.length ? topicNames.join(', ') : 'not filed']}
        actions={
          <>
            <a href={r.url} target="_blank" rel="noreferrer" className={TEXT_ACTION}>
              {r.kind === 'video' ? 'Open on YouTube' : 'Open'}
            </a>
            {mayRemove && (
              <button
                onClick={async () => {
                  if (!confirm('Remove this from the group? Its notes stay, without it.')) return;
                  if (await call(`/api/study/resources/${r.id}`, 'DELETE')) window.location.assign(tabHref(g.id, 'resources'));
                }}
                disabled={busy}
                className={TEXT_DANGER}
              >
                Remove
              </button>
            )}
          </>
        }
      />
      <DetailGrid main={main} aside={aside} />
    </div>
  );
}

function MomentNote({
  g,
  r,
  player,
  call,
  busy,
}: {
  g: StudyGroup;
  r: StudyResource;
  player: React.RefObject<VideoHandle | null>;
  call: Call;
  busy: boolean;
}) {
  const [body, setBody] = useState('');
  const [at, setAt] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const video = r.kind === 'video';
  const now = () => {
    const t = player.current?.current();
    if (t !== null && t !== undefined) setAt(formatTime(t));
  };
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const seconds = video && at.trim() ? parseTime(at) : null;
        const ok = await call(`/api/study/groups/${g.id}`, 'POST', {
          op: 'note',
          body,
          resourceId: r.id,
          at: seconds,
          topicId: r.topicIds[0] ?? null,
          private: isPrivate,
        });
        if (ok) {
          setBody('');
          setAt('');
        }
      }}
      className="t-body space-y-2"
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onFocus={() => video && !at && now()}
        rows={3}
        placeholder={video ? 'A note at this moment' : 'A note on this page'}
        aria-label="Note"
        className={`${FIELD} w-full`}
      />
      <div className="flex flex-wrap items-center gap-2">
        {video && (
          <>
            <input value={at} onChange={(e) => setAt(e.target.value)} placeholder="m:ss" aria-label="Moment" className={`${FIELD} t-num w-20`} />
            <button type="button" onClick={now} className={TEXT_ACTION}>
              now
            </button>
          </>
        )}
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
          Private
        </label>
        <button disabled={busy || !body.trim() || (video && !!at.trim() && parseTime(at) === null)} className={BUTTON}>
          Add the note
        </button>
      </div>
    </form>
  );
}

function EditResource({ r, g, call, busy }: { r: StudyResource; g: StudyGroup; call: Call; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(r.why);
  const [topicIds, setTopicIds] = useState<number[]>(r.topicIds);
  const topics = g.topics.filter((t) => t.review === 'accepted');
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={`t-body mt-3 ${TEXT_ACTION}`}>
        Edit why and topics
      </button>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await call(`/api/study/resources/${r.id}`, 'PATCH', { why, topicIds })) setOpen(false);
      }}
      className="t-body mt-3 max-w-prose space-y-2"
    >
      <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="Why it is worth the time" aria-label="Why" className={`${FIELD} w-full`} />
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        {topics.map((t) => (
          <label key={t.id} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={topicIds.includes(t.id)}
              onChange={(e) => setTopicIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))}
            />
            {t.title}
          </label>
        ))}
      </fieldset>
      <span className="flex gap-3">
        <button disabled={busy} className={BUTTON}>
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className={TEXT_ACTION}>
          Cancel
        </button>
      </span>
    </form>
  );
}

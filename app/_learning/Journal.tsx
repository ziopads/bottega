'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { Call } from '@/app/_learning/Exercise';
import LessonBody from '@/app/_learning/LessonBody';
import { formatWhen } from '@/app/_studio/Notes';
import { Section } from '@/app/_ui/layout';
import { BUTTON, BUTTON_PRIMARY, FIELD, TEXT_ACTION, TEXT_DANGER } from '@/app/_ui/styles';
import { formatTime } from '@/lib/youtube';
import {
  formatMinutes,
  lessonHref,
  resourceHref,
  SESSION_KIND_LABEL,
  SESSION_KINDS,
  studyHistory,
  tabHref,
  type SessionKind,
  type StudyGroup,
  type StudyNote,
  type StudySession,
} from '@/lib/studyTypes';

// The group page's record of study (REQUIREMENTS L-3, L-18 to L-22, db/017):
// sessions (one member's sitting, with the topics it touched and its notes),
// notes (alone, or in a session, on a topic, lesson or exercise), and the
// figures drawn from them. Drafts, documented by Claude through the
// connector, are seen by their author only until published. Each member
// changes only their own; the database enforces the same.

type Titles = Map<number, string | null>;

export const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

/** "2026-10-12T14:30" in local time, for a datetime-local field. */
function localInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Badges({ origin, published, isPrivate }: { origin: string; published: boolean; isPrivate: boolean }) {
  return (
    <>
      {!published && <span className="rounded border border-rust px-1 text-[11px] text-rust">draft</span>}
      {origin === 'assistant' && <span className="text-[11px] text-muted">documented by Claude</span>}
      {isPrivate && <span className="text-[11px] text-muted">private</span>}
    </>
  );
}

// ── Notes ────────────────────────────────────────────────────────────────────

export function NoteForm({
  g,
  call,
  busy,
  fixed,
  onDone,
  initial,
}: {
  g: StudyGroup;
  call: Call;
  busy: boolean;
  /** Context the note is written in, not offered as a choice: a session, a lesson. */
  fixed?: { sessionId?: number; lessonId?: number; topicId?: number };
  onDone?: () => void;
  initial?: StudyNote;
}) {
  const [body, setBody] = useState(initial?.body ?? '');
  const [topicId, setTopicId] = useState(String(initial?.topicId ?? fixed?.topicId ?? ''));
  const [isPrivate, setPrivate] = useState(initial?.private ?? false);
  const topics = g.topics.filter((t) => t.review === 'accepted');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const payload = { body, topicId: topicId || null, private: isPrivate };
        const ok = initial
          ? await call(`/api/study/notes/${initial.id}`, 'PATCH', payload)
          : await call(`/api/study/groups/${g.id}`, 'POST', { op: 'note', ...payload, sessionId: fixed?.sessionId ?? null, lessonId: fixed?.lessonId ?? null });
        if (ok) {
          if (!initial) setBody('');
          onDone?.();
        }
      }}
      className="t-body max-w-prose space-y-2"
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="A note: what you tried, what worked, a question. Cite a page as [15:p42]."
        aria-label="Note"
        className={`${FIELD} w-full`}
      />
      <div className="flex flex-wrap items-center gap-3">
        {!fixed?.lessonId && (
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)} aria-label="Topic" className={FIELD}>
            <option value="">No topic</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
          Private
        </label>
        <button disabled={busy || !body.trim()} className={BUTTON}>
          {initial ? 'Save' : 'Add the note'}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className={TEXT_ACTION}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function NoteItem({
  n,
  g,
  viewerId,
  titles,
  call,
  busy,
  showContext = true,
}: {
  n: StudyNote;
  g: StudyGroup;
  viewerId: string;
  titles: Titles;
  call: Call;
  busy: boolean;
  showContext?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const mine = n.authorId === viewerId && g.status === 'open';
  const topic = n.topicId ? g.topics.find((t) => t.id === n.topicId) : null;
  const lesson = n.lessonId ? g.lessons.find((l) => l.id === n.lessonId) : null;
  const exercise = n.exerciseId ? g.exercises.find((e) => e.id === n.exerciseId) : null;
  const session = n.sessionId ? g.sessions.find((s) => s.id === n.sessionId) : null;
  const resource = n.resourceId ? g.resources.find((r) => r.id === n.resourceId) : null;

  return (
    <li id={`note-${n.id}`} className="py-2">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
        <span className="text-ink">{n.authorName}</span>
        <span>{formatWhen(n.createdAt)}</span>
        {showContext && topic && <span>· {topic.title}</span>}
        {showContext && lesson && (
          <Link href={lessonHref(g.id, lesson.id)} className="hover:text-rust">
            · {lesson.title}
          </Link>
        )}
        {showContext && exercise && <span>· exercise: {exercise.task.slice(0, 60)}</span>}
        {showContext && resource && (
          <Link href={resourceHref(g.id, resource.id, n.positionS)} className="hover:text-rust">
            · {resource.title}
            {n.positionS !== null ? ` at ${formatTime(n.positionS)}` : ''}
          </Link>
        )}
        {showContext && session && (
          <Link href={tabHref(g.id, 'sessions', `session-${session.id}`)} className="hover:text-rust">
            · session of {dayOf(session.startedAt)}
          </Link>
        )}
        <Badges origin={n.origin} published={n.published} isPrivate={n.private} />
        {mine && !editing && (
          <span className="ml-auto flex gap-3">
            <button onClick={() => setEditing(true)} className={TEXT_ACTION}>
              Edit
            </button>
            {!n.published && (
              <button onClick={() => call(`/api/study/notes/${n.id}`, 'DELETE')} disabled={busy} className={TEXT_DANGER}>
                Discard
              </button>
            )}
          </span>
        )}
      </p>
      {editing ? (
        <div className="mt-1">
          <NoteForm g={g} call={call} busy={busy} initial={n} fixed={{ lessonId: n.lessonId ?? undefined }} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div className="mt-0.5">
          <LessonBody body={n.body} titles={titles} labels={g.pageLabels} compact />
        </div>
      )}
    </li>
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────

function SessionForm({
  g,
  call,
  busy,
  initial,
  onDone,
}: {
  g: StudyGroup;
  call: Call;
  busy: boolean;
  initial?: StudySession;
  onDone: () => void;
}) {
  const [when, setWhen] = useState(localInput(initial?.startedAt ?? new Date().toISOString()));
  const [minutes, setMinutes] = useState(initial?.minutes ? String(initial.minutes) : '');
  const [kind, setKind] = useState<SessionKind>(initial?.kind ?? 'at the instrument');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [topicIds, setTopicIds] = useState<number[]>(initial?.topicIds ?? []);
  const [isPrivate, setPrivate] = useState(initial?.private ?? false);
  const [resourceId, setResourceId] = useState(initial?.resourceId ? String(initial.resourceId) : '');
  const topics = g.topics.filter((t) => t.review === 'accepted');
  const resources = g.resources.filter((r) => r.published);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const payload = {
          resourceId: resourceId || null,
          startedAt: new Date(when).toISOString(),
          minutes: minutes || null,
          kind,
          summary,
          private: isPrivate,
          topicIds,
        };
        const ok = initial
          ? await call(`/api/study/sessions/${initial.id}`, 'PATCH', payload)
          : await call(`/api/study/groups/${g.id}`, 'POST', { op: 'session', ...payload });
        if (ok) onDone();
      }}
      className="t-body max-w-prose space-y-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="When" className={FIELD} />
        <input
          type="number"
          min={1}
          max={1440}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="Minutes"
          aria-label="Minutes"
          className={`${FIELD} w-24`}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as SessionKind)} aria-label="Kind" className={FIELD}>
          {SESSION_KINDS.map((k) => (
            <option key={k} value={k}>
              {SESSION_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {resources.length > 0 && (
          <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} aria-label="Spent on" className={`${FIELD} max-w-60`}>
            <option value="">Not on a video</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {topics.length > 0 && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="t-label mb-1">Topics touched</legend>
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
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={5}
        placeholder="What you worked on, what came of it, what to try next."
        aria-label="Summary"
        className={`${FIELD} w-full`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-muted">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
          Private
        </label>
        <button disabled={busy} className={BUTTON}>
          {initial ? 'Save' : 'Log the session'}
        </button>
        <button type="button" onClick={onDone} className={TEXT_ACTION}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SessionItem({ s, g, viewerId, titles, call, busy }: { s: StudySession; g: StudyGroup; viewerId: string; titles: Titles; call: Call; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [noting, setNoting] = useState(false);
  const mine = s.authorId === viewerId && g.status === 'open';
  const notes = g.notes.filter((n) => n.sessionId === s.id).slice().reverse();
  const topicNames = s.topicIds.map((id) => g.topics.find((t) => t.id === id)?.title).filter(Boolean);
  const spentOn = s.resourceId ? g.resources.find((r) => r.id === s.resourceId) : null;

  return (
    <li id={`session-${s.id}`} className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="t-lead">{dayOf(s.startedAt)}</span>
        <span className="t-body text-muted">
          {[s.authorName, SESSION_KIND_LABEL[s.kind], formatMinutes(s.minutes)].filter(Boolean).join(' · ')}
        </span>
        <Badges origin={s.origin} published={s.published} isPrivate={s.private} />
        {mine && !editing && (
          <span className="t-body ml-auto flex gap-3 text-[11px]">
            {!s.published && (
              <button onClick={() => call(`/api/study/sessions/${s.id}`, 'POST', { op: 'publish' })} disabled={busy} className={BUTTON_PRIMARY}>
                Publish
              </button>
            )}
            <button onClick={() => setEditing(true)} className={TEXT_ACTION}>
              Edit
            </button>
            {!s.published && (
              <button
                onClick={() => confirm('Discard this draft and its notes?') && call(`/api/study/sessions/${s.id}`, 'DELETE')}
                disabled={busy}
                className={TEXT_DANGER}
              >
                Discard
              </button>
            )}
          </span>
        )}
      </div>
      {topicNames.length > 0 && <p className="text-[11px] text-muted">Topics: {topicNames.join(', ')}</p>}
      {spentOn && (
        <p className="text-[11px] text-muted">
          On{' '}
          <Link href={resourceHref(g.id, spentOn.id)} className="hover:text-rust">
            {spentOn.title}
          </Link>
        </p>
      )}
      {editing ? (
        <div className="mt-2">
          <SessionForm g={g} call={call} busy={busy} initial={s} onDone={() => setEditing(false)} />
        </div>
      ) : (
        s.summary && (
          <div className="mt-1">
            <LessonBody body={s.summary} titles={titles} labels={g.pageLabels} compact />
          </div>
        )
      )}
      {notes.length > 0 && (
        <ul className="mt-2 divide-y divide-line border-l-2 border-line pl-3">
          {notes.map((n) => (
            <NoteItem key={n.id} n={n} g={g} viewerId={viewerId} titles={titles} call={call} busy={busy} showContext={false} />
          ))}
        </ul>
      )}
      {mine &&
        (noting ? (
          <div className="mt-2 border-l-2 border-line pl-3">
            <NoteForm g={g} call={call} busy={busy} fixed={{ sessionId: s.id }} onDone={() => setNoting(false)} />
          </div>
        ) : (
          <button onClick={() => setNoting(true)} className={`t-body mt-1 ${TEXT_ACTION}`}>
            + Note
          </button>
        ))}
    </li>
  );
}

export function SessionsTab({ g, viewerId, titles, call, busy }: { g: StudyGroup; viewerId: string; titles: Titles; call: Call; busy: boolean }) {
  const [logging, setLogging] = useState(false);
  const open = g.status === 'open';
  const drafts = g.sessions.filter((s) => !s.published && s.authorId === viewerId);
  const rest = g.sessions.filter((s) => s.published);

  return (
    <>
      {drafts.length > 0 && (
        <div className="t-body mb-6 rounded border border-line bg-card px-3 py-2">
          <p className="t-label mb-1">Your drafts · documented by Claude, seen only by you until you publish them</p>
          <ul className="divide-y divide-line">
            {drafts.map((s) => (
              <SessionItem key={s.id} s={s} g={g} viewerId={viewerId} titles={titles} call={call} busy={busy} />
            ))}
          </ul>
        </div>
      )}
      <Section
        label="Sessions"
        action={open && !logging ? <button onClick={() => setLogging(true)} className={TEXT_ACTION}>+ Log a session</button> : undefined}
      >
        {logging && (
          <div className="mb-4">
            <SessionForm g={g} call={call} busy={busy} onDone={() => setLogging(false)} />
          </div>
        )}
        {rest.length === 0 ? (
          <p className="t-body max-w-prose text-muted">
            No sessions yet. Log one here after practising, or at the end of a conversation with Claude say “please document this
            session”: it arrives as a draft above for you to read and publish.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rest.map((s) => (
              <SessionItem key={s.id} s={s} g={g} viewerId={viewerId} titles={titles} call={call} busy={busy} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export function NotesTab({ g, viewerId, titles, call, busy }: { g: StudyGroup; viewerId: string; titles: Titles; call: Call; busy: boolean }) {
  const [member, setMember] = useState('');
  const [topic, setTopic] = useState('');
  const [adding, setAdding] = useState(false);
  const notes = g.notes.filter(
    (n) => (!member || n.authorId === member) && (!topic || String(n.topicId) === topic) && (n.published || n.authorId === viewerId),
  );
  const topics = g.topics.filter((t) => t.review === 'accepted');
  const authors = Array.from(new Map(g.notes.map((n) => [n.authorId, n.authorName])).entries());

  return (
    <Section
      label="Notes"
      action={g.status === 'open' && !adding ? <button onClick={() => setAdding(true)} className={TEXT_ACTION}>+ Note</button> : undefined}
    >
      {adding && (
        <div className="mb-4">
          <NoteForm g={g} call={call} busy={busy} onDone={() => setAdding(false)} />
        </div>
      )}
      {g.notes.length > 0 && (
        <div className="t-body mb-3 flex flex-wrap gap-2">
          <select value={member} onChange={(e) => setMember(e.target.value)} aria-label="Member" className={FIELD}>
            <option value="">Everyone</option>
            {authors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic" className={FIELD}>
            <option value="">Every topic</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {notes.length === 0 ? (
        <p className="t-body text-muted">{g.notes.length ? 'No notes match.' : 'No notes yet.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {notes.map((n) => (
            <NoteItem key={n.id} n={n} g={g} viewerId={viewerId} titles={titles} call={call} busy={busy} />
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── Progress ─────────────────────────────────────────────────────────────────

const PERIODS = [4, 8, 12, 26] as const;

export function ProgressTab({ g }: { g: StudyGroup }) {
  const [weeks, setWeeks] = useState<number>(8);
  // The clock is read once per period chosen, not on every render.
  const h = useMemo(() => studyHistory(g, weeks, new Date()), [g, weeks]);
  const done = g.exercises.filter((e) => e.review === 'accepted');

  return (
    <>
      <div className="t-body mb-4 flex flex-wrap items-center gap-2">
        <span className="text-muted">The last</span>
        {PERIODS.map((w) => (
          <button key={w} onClick={() => setWeeks(w)} className={w === weeks ? 'text-ink underline underline-offset-4' : TEXT_ACTION}>
            {w} weeks
          </button>
        ))}
      </div>
      <p className="t-body mb-6 text-muted">
        {h.sessions} {h.sessions === 1 ? 'session' : 'sessions'}
        {h.minutes ? `, ${formatMinutes(h.minutes)}` : ''} since {dayOf(h.since)}. Counts published sessions you can see.
      </p>

      <Section label="Members">
        {h.members.length === 0 ? (
          <p className="t-body text-muted">No sessions in this period.</p>
        ) : (
          <table className="t-body w-full">
            <tbody>
              {h.members.map((m) => (
                <tr key={m.name} className="border-b border-line">
                  <td className="py-1.5 pr-4">{m.name}</td>
                  <td className="t-num py-1.5 pr-4 text-muted">
                    {m.sessions} {m.sessions === 1 ? 'session' : 'sessions'}
                  </td>
                  <td className="t-num py-1.5 pr-4 text-muted">{formatMinutes(m.minutes) || '—'}</td>
                  <td className="py-1.5" aria-label="Sessions per week, oldest first">
                    <span className="flex items-end gap-0.5">
                      {m.perWeek.map((n, i) => (
                        <span key={i} title={`${n}`} className="inline-block w-2 bg-rust" style={{ height: `${Math.max(2, n * 6)}px`, opacity: n ? 1 : 0.2 }} />
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section label="Topics">
        {h.topics.length === 0 ? (
          <p className="t-body text-muted">No topics in the syllabus yet.</p>
        ) : (
          <table className="t-body w-full">
            <tbody>
              {h.topics.map((t) => (
                <tr key={t.id} className="border-b border-line">
                  <td className="py-1.5 pr-4">{t.title}</td>
                  <td className="t-num py-1.5 pr-4 text-muted">{t.sessions ? `${t.sessions} ${t.sessions === 1 ? 'session' : 'sessions'}` : 'not touched'}</td>
                  <td className="t-num py-1.5 pr-4 text-muted">{formatMinutes(t.minutes) || ''}</td>
                  <td className="py-1.5 text-muted">{t.lastTouched ? `last ${dayOf(t.lastTouched)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {h.untagged > 0 && <p className="mt-2 text-[11px] text-muted">{h.untagged} sessions named no topic.</p>}
      </Section>

      <Section label="Exercises">
        {done.length === 0 ? (
          <p className="t-body text-muted">No exercises yet.</p>
        ) : (
          <ul className="t-body space-y-1">
            {g.members.map((m) => {
              const n = done.filter((e) => e.progress.some((p) => p.accountId === m.accountId && p.status === 'done')).length;
              return (
                <li key={m.accountId}>
                  {m.name}: <span className="t-num">{n}</span> of <span className="t-num">{done.length}</span> done
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import Exercise, { type Call } from '@/app/_learning/Exercise';
import { NotesTab, ProgressTab, SessionsTab } from '@/app/_learning/Journal';
import LessonBody, { titlesOf } from '@/app/_learning/LessonBody';
import { VideosSection } from '@/app/_learning/Resources';
import { api, InlineEdit } from '@/app/_studio/controls';
import { formatWhen } from '@/app/_studio/Notes';
import { DetailGrid, PageHeader, Section, TabBar } from '@/app/_ui/layout';
import { BUTTON, BUTTON_SMALL, BUTTON_SMALL_DANGER, BUTTON_SMALL_PRIMARY, FIELD } from '@/app/_ui/styles';
import {
  GROUP_TAB_LABEL,
  GROUP_TABS,
  lessonHref,
  type GroupTab,
  type StudyGroup,
  type StudyModel,
  type StudyTopic,
} from '@/lib/studyTypes';

// One study group (REQUIREMENTS L-2, L-5, L-7 to L-10, db/016):
//
//   review band     Claude's proposals (topics, lessons, exercises), for the
//                   custodian to accept or reject
//   main column     the syllabus: topics in order, each with its lessons
//                   (linking to the lesson page) and exercises with progress
//   aside           members and invitations; the documents the lessons cite
//                   and whether each is shared with the group
//
// Members read everything and keep their own progress; the custodian writes
// and orders the syllabus. Every change answers with the whole group.
//
// Tabs, as on the session page (the chosen one in the address as ?tab=, kept
// with history.replaceState so switching does not reload): Syllabus, Sessions
// and Notes (Journal.tsx), Resources (next build), Progress. The aside is the
// same on every tab, with the syllabus's contents on the Syllabus tab.

export type ListCandidate = { id: number; title: string; about: string; library: boolean };

export default function GroupView({
  initial,
  viewerId,
  models,
  initialTab,
  candidates,
}: {
  initial: StudyGroup;
  viewerId: string;
  models: StudyModel[];
  initialTab: GroupTab;
  /** Documents the viewer could add to the reading list: approved library manuals, and their own private documents. */
  candidates: ListCandidate[];
}) {
  const router = useRouter();
  const [g, setG] = useState(initial);
  const [tab, setTab] = useState<GroupTab>(initialTab);

  function selectTab(key: string) {
    const next = key as GroupTab;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'syllabus') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    url.hash = '';
    window.history.replaceState(null, '', url);
  }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isCustodian = g.custodianId === viewerId;
  const open = g.status === 'open';
  const custodian = isCustodian && open;
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

  async function reload() {
    const r = await api<{ group: StudyGroup }>(`/api/study/groups/${g.id}`, { method: 'GET' });
    if (r.ok && r.data.group) setG(r.data.group);
  }

  async function leave() {
    if (!confirm(`Leave ${g.name}? You stop seeing its syllabus and the documents shared with it. The custodian can invite you again.`)) return;
    setError('');
    const r = await api(`/api/study/groups/${g.id}`, { method: 'POST', body: JSON.stringify({ op: 'leave' }) });
    if (!r.ok) return setError(r.body.error || 'Could not leave.');
    router.push('/learning');
  }

  const accepted = g.topics.filter((t) => t.review === 'accepted');
  const waitingTopics = g.topics.filter((t) => t.review === 'proposed');
  const waitingLessons = g.lessons.filter((l) => l.review === 'proposed');
  const waitingExercises = g.exercises.filter((e) => e.review === 'proposed');
  const waiting = waitingTopics.length + waitingLessons.length + waitingExercises.length;
  const topicTitle = (id: number) => g.topics.find((t) => t.id === id)?.title ?? 'a topic';
  const topicWaits = (id: number) => g.topics.find((t) => t.id === id)?.review !== 'accepted';

  // ── Review band ──────────────────────────────────────────────────────────────
  const review = waiting > 0 && (
    <div className="t-body mb-6 rounded border border-line bg-card px-3 py-2">
      <p className="t-label mb-1">
        Proposed by Claude · {waiting} waiting{!isCustodian && ` for ${g.custodianName}, the custodian`}
      </p>
      <ul className="divide-y divide-line">
        {waitingTopics.map((t) => (
          <ReviewRow key={`t${t.id}`} kind="topic" id={t.id} label={`Topic · asked by ${t.createdByName}`} canReview={custodian} busy={busy} call={call}>
            <span className="t-lead">{t.title}</span>
            {t.model && <span className="text-muted"> · {t.model.manufacturer} {t.model.model}</span>}
            {t.summary && <p className="text-muted">{t.summary}</p>}
          </ReviewRow>
        ))}
        {waitingLessons.map((l) => (
          <ReviewRow
            key={`l${l.id}`}
            kind="lesson"
            id={l.id}
            label={`Lesson · ${topicTitle(l.topicId)} · asked by ${l.createdByName}`}
            canReview={custodian}
            blocked={topicWaits(l.topicId) ? 'Accept its topic first' : undefined}
            busy={busy}
            call={call}
          >
            <details>
              <summary className="cursor-pointer">{l.title}</summary>
              <div className="mt-2 border-l-2 border-line pl-3">
                <LessonBody body={l.body} titles={titles} labels={g.pageLabels} compact />
              </div>
            </details>
          </ReviewRow>
        ))}
        {waitingExercises.map((e) => (
          <ReviewRow
            key={`e${e.id}`}
            kind="exercise"
            id={e.id}
            label={`Exercise · ${topicTitle(e.topicId)}${e.lessonId ? ` · ${g.lessons.find((l) => l.id === e.lessonId)?.title ?? ''}` : ''} · asked by ${e.createdByName}`}
            canReview={custodian}
            blocked={topicWaits(e.topicId) ? 'Accept its topic first' : undefined}
            busy={busy}
            call={call}
          >
            <p>{e.task}</p>
            <p className="text-[11px] text-muted">Done when: {e.doneWhen}</p>
          </ReviewRow>
        ))}
      </ul>
    </div>
  );

  const drafts = g.sessions.filter((x) => !x.published && x.authorId === viewerId).length;
  const tabCount: Partial<Record<GroupTab, number>> = {
    sessions: g.sessions.filter((x) => x.published).length,
    notes: g.notes.filter((n) => n.published || n.authorId === viewerId).length,
    resources: g.resources.filter((r) => r.published).length,
  };

  // ── Main column: the syllabus ───────────────────────────────────────────────
  const syllabus = (
    <>
      {review}
      {accepted.length === 0 ? (
        <Section label="Syllabus">
          <p className="t-body max-w-prose text-muted">
            No topics yet.{' '}
            {isCustodian
              ? 'Add the first below, or ask Claude (with the Bottega connector) to draft a syllabus from a manual or book: its topics, lessons and exercises arrive above for you to accept.'
              : `${g.custodianName} writes the syllabus.`}
          </p>
        </Section>
      ) : (
        accepted.map((t, i) => (
          <Topic key={t.id} g={g} t={t} n={i + 1} viewerId={viewerId} custodian={custodian} member={open} models={models} busy={busy} call={call} />
        ))
      )}
      {custodian && <AddTopic groupId={g.id} models={models} busy={busy} call={call} />}
    </>
  );

  const main = (
    <>
      {tab === 'syllabus' && syllabus}
      {tab === 'sessions' && <SessionsTab g={g} viewerId={viewerId} titles={titles} call={call} busy={busy} />}
      {tab === 'notes' && <NotesTab g={g} viewerId={viewerId} titles={titles} call={call} busy={busy} />}
      {tab === 'resources' && (
        <>
          <VideosSection g={g} viewerId={viewerId} call={call} busy={busy} />
          <ReadingList g={g} viewerId={viewerId} candidates={candidates} busy={busy} setError={setError} reload={reload} />
        </>
      )}
      {tab === 'progress' && <ProgressTab g={g} />}
      {error && <p className="t-body mt-4 text-rust">{error}</p>}
    </>
  );

  // ── Aside: members and documents ────────────────────────────────────────────
  const aside = (
    <>
      {tab === 'syllabus' && accepted.length > 0 && <Contents g={g} viewerId={viewerId} />}
      <Members g={g} viewerId={viewerId} custodian={custodian} busy={busy} call={call} />
      <Section label="Reading list">
        <p className="t-body">
          <button onClick={() => selectTab('resources')} className="hover:text-rust">
            {g.documents.filter((d) => d.sharedWithGroup).length || 'No'}{' '}
            {g.documents.filter((d) => d.sharedWithGroup).length === 1 ? 'document' : 'documents'}
          </button>
          <span className="text-muted"> · what Claude searches for this group</span>
        </p>
      </Section>
      <Section label="With Claude">
        <p className="t-body text-muted">
          Through the Bottega connector, Claude reads this group (get_study_group, list_study_notes, get_study_history), proposes
          topics, lessons and exercises for the custodian to accept (draft_topic, draft_lesson, draft_exercise), and documents a study
          session with its notes when you ask (record_study_session), as a draft only you see until you publish it. Citations are
          written [document:pPage] and checked against the page text.
        </p>
      </Section>
    </>
  );

  return (
    <div>
      <PageHeader
        back={{ href: '/learning', label: 'Learning' }}
        title={custodian ? <InlineEdit value={g.name} placeholder="Name" label="Name" textClass="t-title" onSave={(v) => call(`/api/study/groups/${g.id}`, 'PATCH', { name: v })} /> : g.name}
        meta={[
          `custodian ${g.custodianName}`,
          `${g.members.length} ${g.members.length === 1 ? 'member' : 'members'}`,
          `started ${formatWhen(g.createdAt).split(',').slice(0, 2).join(',')}`,
          !open ? 'closed: readable, no new writing' : null,
        ]}
        actions={
          isCustodian ? (
            <button
              onClick={() =>
                (open ? confirm('Close the group? Members keep reading it; nobody writes, records progress or joins until you reopen it.') : true) &&
                call(`/api/study/groups/${g.id}`, 'PATCH', { status: open ? 'closed' : 'open' })
              }
              disabled={busy}
              className={BUTTON_SMALL}
            >
              {open ? 'Close the group' : 'Reopen the group'}
            </button>
          ) : (
            <button onClick={leave} className={BUTTON_SMALL_DANGER}>
              Leave the group
            </button>
          )
        }
      />
      {(g.description || custodian) && (
        <div className="t-body -mt-3 mb-6 max-w-prose">
          {custodian ? (
            <InlineEdit value={g.description} placeholder="What the group is for" label="Description" onSave={(v) => call(`/api/study/groups/${g.id}`, 'PATCH', { description: v })} />
          ) : (
            <p>{g.description}</p>
          )}
        </div>
      )}
      <div className="mb-6 border-b border-line">
        <TabBar
          current={tab}
          onSelect={selectTab}
          tabs={GROUP_TABS.map((key) => ({
            key,
            label: key === 'sessions' && drafts ? `Sessions · ${drafts} draft${drafts === 1 ? '' : 's'}` : GROUP_TAB_LABEL[key],
            count: tabCount[key],
          }))}
        />
      </div>
      <DetailGrid main={main} aside={aside} />
    </div>
  );
}

/** The syllabus at a glance, beside it: topics and their lessons, with the viewer's exercises done. */
function Contents({ g, viewerId }: { g: StudyGroup; viewerId: string }) {
  const topics = g.topics.filter((t) => t.review === 'accepted');
  return (
    <Section label="Contents">
      <ol className="t-body space-y-2">
        {topics.map((t, i) => {
          const lessons = g.lessons.filter((l) => l.topicId === t.id && l.review === 'accepted');
          const exercises = g.exercises.filter((e) => e.topicId === t.id && e.review === 'accepted');
          const done = exercises.filter((e) => e.progress.some((p) => p.accountId === viewerId && p.status === 'done')).length;
          return (
            <li key={t.id}>
              <a href={`#topic-${t.id}`} className="flex items-baseline gap-2 hover:text-rust">
                <span className="t-num w-5 shrink-0 text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">{t.title}</span>
                {exercises.length > 0 && (
                  <span className={`t-num text-[11px] ${done === exercises.length ? 'text-moss' : 'text-muted'}`}>
                    {done}/{exercises.length}
                  </span>
                )}
              </a>
              {lessons.length > 0 && (
                <ol className="ml-7 mt-0.5 space-y-0.5 text-[12px]">
                  {lessons.map((l, j) => (
                    <li key={l.id}>
                      <Link href={lessonHref(g.id, l.id)} className="flex gap-2 text-muted hover:text-rust">
                        <span className="t-num w-6 shrink-0">
                          {i + 1}.{j + 1}
                        </span>
                        <span className="min-w-0">{l.title}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function ReviewRow({
  kind,
  id,
  label,
  canReview,
  blocked,
  busy,
  call,
  children,
}: {
  kind: 'topic' | 'lesson' | 'exercise';
  id: number;
  label: string;
  canReview: boolean;
  blocked?: string;
  busy: boolean;
  call: Call;
  children: React.ReactNode;
}) {
  const url = `/api/study/${kind === 'topic' ? 'topics' : kind === 'lesson' ? 'lessons' : 'exercises'}/${id}`;
  return (
    <li className="py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-[11px] text-muted">{label}</span>
        {canReview && (
          <span className="ml-auto flex gap-3 text-[11px]">
            <button onClick={() => call(url, 'PATCH', { accept: true })} disabled={busy || !!blocked} title={blocked} className={BUTTON_SMALL_PRIMARY}>
              Accept
            </button>
            <button onClick={() => call(url, 'PATCH', { reject: true })} disabled={busy} className={BUTTON_SMALL_DANGER}>
              Reject
            </button>
          </span>
        )}
      </div>
      <div className="min-w-0">{children}</div>
      {canReview && blocked && <p className="text-[11px] text-muted">{blocked}.</p>}
    </li>
  );
}

function Topic({
  g,
  t,
  n,
  viewerId,
  custodian,
  member,
  models,
  busy,
  call,
}: {
  g: StudyGroup;
  t: StudyTopic;
  n: number;
  viewerId: string;
  custodian: boolean;
  member: boolean;
  models: StudyModel[];
  busy: boolean;
  call: Call;
}) {
  const [adding, setAdding] = useState<'lesson' | 'exercise' | null>(null);
  const lessons = g.lessons.filter((l) => l.topicId === t.id && l.review === 'accepted');
  const exercises = g.exercises.filter((e) => e.topicId === t.id && e.review === 'accepted');
  const url = `/api/study/topics/${t.id}`;
  const lessonTitle = (id: number | null) => (id === null ? null : lessons.find((l) => l.id === id)?.title ?? null);

  return (
    <section id={`topic-${t.id}`} className="mb-10 scroll-mt-4">
      <div className="mb-2 flex items-baseline gap-3 border-b border-line pb-1">
        <span className="t-num t-label">{n}</span>
        <h2 className="t-lead min-w-0 flex-1 font-semibold">
          {custodian ? <InlineEdit value={t.title} placeholder="Title" label="Topic title" textClass="t-lead" onSave={(v) => call(url, 'PATCH', { title: v })} /> : t.title}
        </h2>
        {custodian ? (
          <select
            value={t.model?.id ?? ''}
            onChange={(e) => call(url, 'PATCH', { modelId: e.target.value || null })}
            disabled={busy}
            aria-label="Instrument"
            className={`${FIELD} max-w-48`}
          >
            <option value="">Any instrument</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.manufacturer} {m.model}
              </option>
            ))}
          </select>
        ) : (
          t.model && <span className="t-body text-muted">{t.model.manufacturer} {t.model.model}</span>
        )}
        {custodian && (
          <span className="flex gap-2 text-[11px]">
            <button onClick={() => call(url, 'PATCH', { move: 'up' })} disabled={busy} className={BUTTON_SMALL} aria-label="Move topic up">
              ↑
            </button>
            <button onClick={() => call(url, 'PATCH', { move: 'down' })} disabled={busy} className={BUTTON_SMALL} aria-label="Move topic down">
              ↓
            </button>
          </span>
        )}
      </div>
      {(t.summary || custodian) && (
        <div className="t-body mb-3 max-w-prose text-muted">
          {custodian ? <InlineEdit value={t.summary} placeholder="What this topic covers" label="Summary" onSave={(v) => call(url, 'PATCH', { summary: v })} /> : t.summary}
        </div>
      )}

      <p className="t-label mb-1">Lessons</p>
      {lessons.length === 0 ? (
        <p className="t-body mb-3 text-muted">None yet.</p>
      ) : (
        <ol className="t-body mb-3 space-y-1">
          {lessons.map((l, i) => (
            <li key={l.id} className="flex items-baseline gap-3">
              <span className="t-num w-6 shrink-0 text-muted">
                {n}.{i + 1}
              </span>
              <Link href={lessonHref(g.id, l.id)} className="min-w-0 flex-1 hover:text-rust">
                {l.title}
              </Link>
              {custodian && (
                <span className="flex gap-2 text-[11px]">
                  <button onClick={() => call(`/api/study/lessons/${l.id}`, 'PATCH', { move: 'up' })} disabled={busy} className={BUTTON_SMALL} aria-label="Move lesson up">
                    ↑
                  </button>
                  <button onClick={() => call(`/api/study/lessons/${l.id}`, 'PATCH', { move: 'down' })} disabled={busy} className={BUTTON_SMALL} aria-label="Move lesson down">
                    ↓
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <p className="t-label mb-1">Exercises</p>
      {exercises.length === 0 ? (
        <p className="t-body text-muted">None yet.</p>
      ) : (
        <ul className="t-body divide-y divide-line">
          {exercises.map((e) => (
            <Exercise
              key={e.id}
              exercise={e}
              viewerId={viewerId}
              canProgress={member}
              custodian={custodian}
              lessonTitle={lessonTitle(e.lessonId)}
              call={call}
              busy={busy}
            />
          ))}
        </ul>
      )}

      {custodian && (
        <div className="t-body mt-3">
          {adding === null && (
            <span className="flex gap-4">
              <button onClick={() => setAdding('lesson')} className={BUTTON_SMALL}>
                + Lesson
              </button>
              <button onClick={() => setAdding('exercise')} className={BUTTON_SMALL}>
                + Exercise
              </button>
            </span>
          )}
          {adding === 'lesson' && <LessonForm busy={busy} onCancel={() => setAdding(null)} onSave={async (title, body) => (await call(url, 'POST', { op: 'lesson', title, body })) && setAdding(null)} />}
          {adding === 'exercise' && (
            <ExerciseForm
              lessons={lessons.map((l) => ({ id: l.id, title: l.title }))}
              busy={busy}
              onCancel={() => setAdding(null)}
              onSave={async (task, doneWhen, lessonId) => (await call(url, 'POST', { op: 'exercise', task, doneWhen, lessonId })) && setAdding(null)}
            />
          )}
        </div>
      )}
    </section>
  );
}

export function LessonForm({
  initialTitle = '',
  initialBody = '',
  busy,
  onSave,
  onCancel,
}: {
  initialTitle?: string;
  initialBody?: string;
  busy: boolean;
  onSave: (title: string, body: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(title, body);
      }}
      className="max-w-prose space-y-2"
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson title" aria-label="Lesson title" className={`${FIELD} w-full`} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} aria-label="Lesson" className={`${FIELD} w-full font-mono text-[12px]`} />
      <p className="text-[11px] text-muted">
        Cite a page as [15:p42], a range as [15:p42-43], or with the words quoted: [15:p42 &quot;chop the sample&quot;]. Document numbers are in
        each document’s address in the Library. Quotations are checked against the page text. ## starts a heading, - a list, **bold**.
      </p>
      <span className="flex gap-3">
        <button disabled={busy || !title.trim() || !body.trim()} className={BUTTON}>
          Save
        </button>
        <button type="button" onClick={onCancel} className={BUTTON}>
          Cancel
        </button>
      </span>
    </form>
  );
}

function ExerciseForm({
  lessons,
  busy,
  onSave,
  onCancel,
}: {
  lessons: { id: number; title: string }[];
  busy: boolean;
  onSave: (task: string, doneWhen: string, lessonId: number | null) => void;
  onCancel: () => void;
}) {
  const [task, setTask] = useState('');
  const [doneWhen, setDoneWhen] = useState('');
  const [lessonId, setLessonId] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(task, doneWhen, lessonId ? Number(lessonId) : null);
      }}
      className="max-w-prose space-y-2"
    >
      <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={2} placeholder="The task" aria-label="Task" className={`${FIELD} w-full`} />
      <input value={doneWhen} onChange={(e) => setDoneWhen(e.target.value)} placeholder="Done when…" aria-label="Done when" className={`${FIELD} w-full`} />
      {lessons.length > 0 && (
        <select value={lessonId} onChange={(e) => setLessonId(e.target.value)} aria-label="Lesson" className={FIELD}>
          <option value="">The whole topic</option>
          {lessons.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
      )}
      <span className="flex gap-3">
        <button disabled={busy || !task.trim() || !doneWhen.trim()} className={BUTTON}>
          Save
        </button>
        <button type="button" onClick={onCancel} className={BUTTON}>
          Cancel
        </button>
      </span>
    </form>
  );
}

function AddTopic({ groupId, models, busy, call }: { groupId: number; models: StudyModel[]; busy: boolean; call: Call }) {
  const [title, setTitle] = useState('');
  const [modelId, setModelId] = useState('');
  return (
    <Section label="Add a topic">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call(`/api/study/groups/${groupId}`, 'POST', { op: 'topic', title, modelId: modelId || null })) {
            setTitle('');
          }
        }}
        className="t-body flex flex-wrap gap-2"
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Such as Sampling and chopping" aria-label="Topic title" className={`${FIELD} min-w-0 flex-1`} />
        <select value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="Instrument" className={FIELD}>
          <option value="">Any instrument</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.manufacturer} {m.model}
            </option>
          ))}
        </select>
        <button disabled={busy || !title.trim()} className={BUTTON}>
          Add
        </button>
      </form>
    </Section>
  );
}

function Members({ g, viewerId, custodian, busy, call }: { g: StudyGroup; viewerId: string; custodian: boolean; busy: boolean; call: Call }) {
  const [email, setEmail] = useState('');
  const url = `/api/study/groups/${g.id}`;
  return (
    <Section label="Members">
      <ul className="t-body space-y-1">
        {g.members.map((m) => (
          <li key={m.accountId} className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1">
              {m.name}
              {m.accountId === viewerId && <span className="text-muted"> (you)</span>}
              {m.accountId === g.custodianId && <span className="text-muted"> · custodian</span>}
            </span>
            {custodian && m.accountId !== g.custodianId && (
              <button
                onClick={() => confirm(`Remove ${m.name} from the group? Their progress is kept; they stop seeing the group and its documents.`) && call(url, 'POST', { op: 'remove', accountId: m.accountId })}
                disabled={busy}
                className={BUTTON_SMALL_DANGER}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {g.invitations.length > 0 && (
        <>
          <p className="t-label mb-1 mt-3">Invited</p>
          <ul className="t-body space-y-1">
            {g.invitations.map((inv) => (
              <li key={inv.id} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-muted">{inv.name}</span>
                {custodian && (
                  <button onClick={() => call(url, 'POST', { op: 'withdraw', invitationId: inv.id })} disabled={busy} className={BUTTON_SMALL}>
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {custodian && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call(url, 'POST', { op: 'invite', email })) setEmail('');
          }}
          className="t-body mt-3 flex gap-2"
        >
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their@email" aria-label="Email to invite" className={`${FIELD} min-w-0 flex-1`} />
          <button disabled={busy || !email.trim()} className={BUTTON}>
            Invite
          </button>
        </form>
      )}
      {custodian && <p className="mt-1 text-[11px] text-muted">They need an approved account. The invitation waits on their Learning page.</p>}
    </Section>
  );
}

/**
 * The group's reading list (019): the documents its study draws on, which
 * Claude searches for the group and every member reads. The custodian adds
 * and removes library manuals; a member adds or removes their own private
 * documents, which shares them with the group. Below it, documents the
 * lessons, sessions or notes cite that are not on the list.
 */
function ReadingList({
  g,
  viewerId,
  candidates,
  busy,
  setError,
  reload,
}: {
  g: StudyGroup;
  viewerId: string;
  candidates: ListCandidate[];
  busy: boolean;
  setError: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const [adding, setAdding] = useState('');
  const custodian = g.custodianId === viewerId && g.status === 'open';
  const listed = g.documents.filter((d) => d.sharedWithGroup);
  const cited = g.documents.filter((d) => !d.sharedWithGroup && d.citedBy > 0);
  const onList = new Set(listed.map((d) => d.id));
  const offer = candidates.filter((c) => !onList.has(c.id) && (c.library ? custodian : g.status === 'open'));

  async function change(id: number, add: boolean) {
    setError('');
    const r = await api(`/api/documents/${id}/groups`, { method: add ? 'POST' : 'DELETE', body: JSON.stringify({ groupId: g.id }) });
    if (!r.ok) return setError(r.body.error || 'Could not change the reading list.');
    setAdding('');
    await reload();
  }

  const mayRemove = (d: StudyGroup['documents'][number]) => (d.library ? custodian : d.mine);

  return (
    <>
      <Section label="Reading list">
        <p className="t-body mb-3 max-w-prose text-muted">
          What this group studies from. When Claude works on the group, it searches these documents only. Every member can read them.
        </p>
        {listed.length === 0 ? (
          <p className="t-body text-muted">Nothing on the list yet.</p>
        ) : (
          <ul className="t-body divide-y divide-line border-y border-line">
            {listed.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                {d.title ? (
                  <Link href={`/library/${d.id}`} className="font-medium hover:text-rust">
                    {d.title}
                  </Link>
                ) : (
                  <span className="text-muted">Document {d.id}</span>
                )}
                {d.about && <span className="text-muted">{d.about}</span>}
                <span className="text-[11px] text-muted">{d.library ? 'library manual' : 'shared by its owner'}</span>
                <span className="ml-auto text-[11px] text-muted">
                  {[
                    d.pagesDone === 0
                      ? 'not searchable yet'
                      : d.pageCount !== null && d.pagesDone < d.pageCount
                        ? `searchable to p. ${d.pagesDone}`
                        : `${d.pageCount ?? d.pagesDone} pages`,
                    d.citedBy ? `cited in ${d.citedBy} ${d.citedBy === 1 ? 'lesson' : 'lessons'}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {mayRemove(d) && (
                  <button onClick={() => change(d.id, false)} disabled={busy} className={BUTTON_SMALL_DANGER}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {offer.length > 0 && (
          <div className="t-body mt-3 flex flex-wrap items-center gap-2">
            <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Document to add" className={`${FIELD} min-w-0 max-w-full flex-1`}>
              <option value="">Add a document…</option>
              {offer.some((c) => c.library) && (
                <optgroup label="Library manuals">
                  {offer
                    .filter((c) => c.library)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                        {c.about ? ` · ${c.about}` : ''}
                      </option>
                    ))}
                </optgroup>
              )}
              {offer.some((c) => !c.library) && (
                <optgroup label="Your documents (shares them with the group)">
                  {offer
                    .filter((c) => !c.library)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            <button onClick={() => adding && change(Number(adding), true)} disabled={busy || !adding} className={BUTTON}>
              Add
            </button>
          </div>
        )}
        {!custodian && g.status === 'open' && (
          <p className="mt-2 text-[11px] text-muted">{g.custodianName}, the custodian, adds library manuals; you can add your own documents.</p>
        )}
      </Section>

      {cited.length > 0 && (
        <Section label="Cited, not on the list">
          <ul className="t-body space-y-1">
            {cited.map((d) => (
              <li key={d.id}>
                {d.title ? (
                  <Link href={`/library/${d.id}`} className="hover:text-rust">
                    {d.title}
                  </Link>
                ) : (
                  <span className="text-muted">Document {d.id} (not readable by you)</span>
                )}
                <span className="text-[11px] text-muted"> · cited in {d.citedBy} {d.citedBy === 1 ? 'lesson' : 'lessons'}</span>
                {((d.library && custodian) || (!d.library && d.mine)) && (
                  <button onClick={() => change(d.id, true)} disabled={busy} className={`ml-2 ${BUTTON_SMALL}`}>
                    Add to the list
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">Members who cannot read a private one see its citations without links.</p>
        </Section>
      )}

    </>
  );
}

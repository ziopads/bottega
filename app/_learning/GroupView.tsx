'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import Exercise, { type Call } from '@/app/_learning/Exercise';
import LessonBody, { titlesOf } from '@/app/_learning/LessonBody';
import { api, InlineEdit } from '@/app/_studio/controls';
import { formatWhen } from '@/app/_studio/Notes';
import { DetailGrid, PageHeader, Section } from '@/app/_ui/layout';
import { BUTTON, FIELD, TEXT_ACTION, TEXT_DANGER } from '@/app/_ui/styles';
import { lessonHref, type StudyGroup, type StudyModel, type StudyTopic } from '@/lib/studyTypes';

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

export default function GroupView({ initial, viewerId, models }: { initial: StudyGroup; viewerId: string; models: StudyModel[] }) {
  const router = useRouter();
  const [g, setG] = useState(initial);
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
                <LessonBody body={l.body} titles={titles} compact />
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

  // ── Main column: the syllabus ───────────────────────────────────────────────
  const main = (
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
      {error && <p className="t-body mt-4 text-rust">{error}</p>}
    </>
  );

  // ── Aside: members and documents ────────────────────────────────────────────
  const aside = (
    <>
      <Members g={g} viewerId={viewerId} custodian={custodian} busy={busy} call={call} />
      <Documents g={g} isCustodian={isCustodian} busy={busy} setError={setError} reload={reload} />
      <Section label="With Claude">
        <p className="t-body text-muted">
          Through the Bottega connector, Claude can read this group with get_study_group and propose topics, lessons and exercises
          (draft_topic, draft_lesson, draft_exercise). Lessons cite pages as [document:pPage], checked against the page text; proposals
          wait above until the custodian accepts them.
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
              className={TEXT_ACTION}
            >
              {open ? 'Close the group' : 'Reopen the group'}
            </button>
          ) : (
            <button onClick={leave} className={TEXT_DANGER}>
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
      <DetailGrid main={main} aside={aside} />
    </div>
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
            <button onClick={() => call(url, 'PATCH', { accept: true })} disabled={busy || !!blocked} title={blocked} className="hover:text-ink disabled:opacity-50">
              Accept
            </button>
            <button onClick={() => call(url, 'PATCH', { reject: true })} disabled={busy} className="text-muted hover:text-rust">
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
    <section className="mb-10">
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
            <button onClick={() => call(url, 'PATCH', { move: 'up' })} disabled={busy} className={TEXT_ACTION} aria-label="Move topic up">
              ↑
            </button>
            <button onClick={() => call(url, 'PATCH', { move: 'down' })} disabled={busy} className={TEXT_ACTION} aria-label="Move topic down">
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
                  <button onClick={() => call(`/api/study/lessons/${l.id}`, 'PATCH', { move: 'up' })} disabled={busy} className={TEXT_ACTION} aria-label="Move lesson up">
                    ↑
                  </button>
                  <button onClick={() => call(`/api/study/lessons/${l.id}`, 'PATCH', { move: 'down' })} disabled={busy} className={TEXT_ACTION} aria-label="Move lesson down">
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
              <button onClick={() => setAdding('lesson')} className={TEXT_ACTION}>
                + Lesson
              </button>
              <button onClick={() => setAdding('exercise')} className={TEXT_ACTION}>
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
        <button type="button" onClick={onCancel} className={TEXT_ACTION}>
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
        <button type="button" onClick={onCancel} className={TEXT_ACTION}>
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
                className={`text-[11px] ${TEXT_DANGER}`}
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
                  <button onClick={() => call(url, 'POST', { op: 'withdraw', invitationId: inv.id })} disabled={busy} className={`text-[11px] ${TEXT_ACTION}`}>
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

function Documents({
  g,
  isCustodian,
  busy,
  setError,
  reload,
}: {
  g: StudyGroup;
  isCustodian: boolean;
  busy: boolean;
  setError: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const docs = g.documents.filter((d) => d.sharedWithGroup || d.citedBy > 0);
  async function toggle(id: number, share: boolean) {
    setError('');
    const r = await api(`/api/documents/${id}/groups`, { method: share ? 'POST' : 'DELETE', body: JSON.stringify({ groupId: g.id }) });
    if (!r.ok) return setError(r.body.error || 'Could not change the sharing.');
    await reload();
  }
  if (!docs.length && !isCustodian) return null;
  return (
    <Section label="Documents">
      {docs.length === 0 ? (
        <p className="t-body text-muted">The lessons cite no documents yet. Share a private book with the group from its page in the Library.</p>
      ) : (
        <ul className="t-body space-y-2">
          {docs.map((d) => (
            <li key={d.id}>
              {d.title ? (
                <Link href={`/library/${d.id}`} className="hover:text-rust">
                  {d.title}
                </Link>
              ) : (
                <span className="text-muted">Document {d.id} (not readable by you)</span>
              )}
              <span className="block text-[11px] text-muted">
                {[
                  d.citedBy > 0 ? `cited in ${d.citedBy} ${d.citedBy === 1 ? 'lesson' : 'lessons'}` : null,
                  d.sharedWithGroup ? 'shared with the group' : 'not shared with the group: members who cannot read it see the citation without its link',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {d.mine && (
                <button onClick={() => toggle(d.id, !d.sharedWithGroup)} disabled={busy} className={`text-[11px] ${d.sharedWithGroup ? TEXT_DANGER : TEXT_ACTION}`}>
                  {d.sharedWithGroup ? 'Stop sharing with the group' : 'Share with the group'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

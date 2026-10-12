'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import Exercise, { type Call } from '@/app/_learning/Exercise';
import { LessonForm } from '@/app/_learning/GroupView';
import { NoteForm, NoteItem } from '@/app/_learning/Journal';
import LessonBody, { titlesOf } from '@/app/_learning/LessonBody';
import { api, InlineEdit } from '@/app/_studio/controls';
import { formatWhen } from '@/app/_studio/Notes';
import { DetailGrid, PageHeader, Section } from '@/app/_ui/layout';
import { TEXT_ACTION } from '@/app/_ui/styles';
import { lessonHref, type StudyGroup } from '@/lib/studyTypes';

// One lesson of a group's syllabus: its body with the citations linked to
// the page reader, the exercises that belong to it with each member's
// progress, and the way to the lessons before and after it. The custodian
// edits it here; a changed body has its citations checked again.

export default function LessonView({ initial, lessonId, viewerId }: { initial: StudyGroup; lessonId: number; viewerId: string }) {
  const [g, setG] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
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

  const lesson = g.lessons.find((l) => l.id === lessonId);
  if (!lesson) {
    return (
      <p className="t-body text-muted">
        This lesson is no longer in the group. <Link href={`/learning/${g.id}`}>Back to {g.name}</Link>
      </p>
    );
  }
  const topic = g.topics.find((t) => t.id === lesson.topicId);
  const open = g.status === 'open';
  const custodian = g.custodianId === viewerId && open;
  const url = `/api/study/lessons/${lesson.id}`;

  // The syllabus in reading order: accepted topics, then their accepted lessons.
  const order = g.topics
    .filter((t) => t.review === 'accepted')
    .flatMap((t) => g.lessons.filter((l) => l.topicId === t.id && l.review === 'accepted'));
  const at = order.findIndex((l) => l.id === lesson.id);
  const prev = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const topicNumber = g.topics.filter((t) => t.review === 'accepted').findIndex((t) => t.id === lesson.topicId) + 1;
  const lessonNumber = g.lessons.filter((l) => l.topicId === lesson.topicId && l.review === 'accepted').findIndex((l) => l.id === lesson.id) + 1;

  const exercises = g.exercises.filter((e) => e.lessonId === lesson.id && e.review === 'accepted');

  const main = (
    <>
      {lesson.review !== 'accepted' && (
        <p className="t-body mb-4 rounded border border-line bg-card px-3 py-2">
          {lesson.review === 'proposed' ? `Proposed by Claude, waiting for ${g.custodianName} to accept or reject it.` : 'This proposal was rejected.'}
        </p>
      )}
      {editing ? (
        <LessonForm
          initialTitle={lesson.title}
          initialBody={lesson.body}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (title, body) => (await call(url, 'PATCH', { title, body })) && setEditing(false)}
        />
      ) : (
        <LessonBody body={lesson.body} titles={titles} />
      )}
      {error && <p className="t-body mt-4 text-rust">{error}</p>}

      <nav className="t-body mt-10 flex justify-between gap-4 border-t border-line pt-3">
        {prev ? (
          <Link href={lessonHref(g.id, prev.id)} className="hover:text-rust">
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={lessonHref(g.id, next.id)} className="text-right hover:text-rust">
            {next.title} →
          </Link>
        )}
      </nav>
    </>
  );

  const notes = g.notes.filter((n) => n.lessonId === lesson.id && (n.published || n.authorId === viewerId));

  const aside = (
    <>
      <Section label="Exercises">
        {exercises.length === 0 ? (
          <p className="t-body text-muted">None for this lesson.</p>
        ) : (
          <ul className="t-body divide-y divide-line">
            {exercises.map((e) => (
              <Exercise key={e.id} exercise={e} viewerId={viewerId} canProgress={open} custodian={custodian} call={call} busy={busy} />
            ))}
          </ul>
        )}
      </Section>
      <Section label="Notes on this lesson">
        {notes.length > 0 && (
          <ul className="mb-3 divide-y divide-line">
            {notes.map((n) => (
              <NoteItem key={n.id} n={n} g={g} viewerId={viewerId} titles={titles} call={call} busy={busy} showContext={false} />
            ))}
          </ul>
        )}
        {open && <NoteForm g={g} call={call} busy={busy} fixed={{ lessonId: lesson.id, topicId: lesson.topicId }} />}
      </Section>
    </>
  );

  return (
    <div>
      <PageHeader
        back={{ href: `/learning/${g.id}`, label: g.name }}
        title={
          custodian && !editing ? (
            <InlineEdit value={lesson.title} placeholder="Title" label="Lesson title" textClass="t-title" onSave={(v) => call(url, 'PATCH', { title: v })} />
          ) : (
            lesson.title
          )
        }
        meta={[
          topicNumber > 0 && lessonNumber > 0 ? `${topicNumber}.${lessonNumber}` : null,
          topic?.title ?? null,
          lesson.origin === 'assistant' ? `drafted by Claude for ${lesson.createdByName}` : `written by ${lesson.createdByName}`,
          `updated ${formatWhen(lesson.updatedAt)}`,
        ]}
        actions={
          custodian && !editing ? (
            <button onClick={() => setEditing(true)} className={TEXT_ACTION}>
              Edit the lesson
            </button>
          ) : undefined
        }
      />
      <DetailGrid main={main} aside={aside} />
    </div>
  );
}

'use client';

import { useState } from 'react';

import { InlineEdit } from '@/app/_studio/controls';
import { BUTTON, FIELD } from '@/app/_ui/styles';
import { PROGRESS_LABEL, STUDY_PROGRESS, type StudyExercise, type StudyProgressStatus } from '@/lib/studyTypes';

// One exercise: the task, how it will be known to be done, the viewer's own
// progress to set, and every other member's (REQUIREMENTS L-5). The custodian
// also edits and reorders it.

export type Call = (url: string, method: string, body?: unknown) => Promise<boolean>;

export default function Exercise({
  exercise: e,
  viewerId,
  canProgress,
  custodian,
  lessonTitle,
  call,
  busy,
}: {
  exercise: StudyExercise;
  viewerId: string;
  /** A member of an open group. */
  canProgress: boolean;
  /** The custodian of an open group: edit and reorder. */
  custodian: boolean;
  /** The lesson it belongs to, when shown away from that lesson. */
  lessonTitle?: string | null;
  call: Call;
  busy: boolean;
}) {
  const mine = e.progress.find((p) => p.accountId === viewerId);
  const others = e.progress.filter((p) => p.accountId !== viewerId && p.status !== 'not started');
  const [note, setNote] = useState(mine?.note ?? '');
  const status: StudyProgressStatus = mine?.status ?? 'not started';
  const url = `/api/study/exercises/${e.id}`;

  return (
    <li className="py-2">
      <div className="flex items-baseline gap-3">
        <span className={`t-label w-20 shrink-0 ${status === 'done' ? 'text-moss' : status === 'practising' ? 'text-rust' : ''}`}>
          {PROGRESS_LABEL[status]}
        </span>
        <div className="min-w-0 flex-1">
          {custodian ? (
            <InlineEdit value={e.task} placeholder="The task" label="Task" onSave={(v) => call(url, 'PATCH', { task: v })} />
          ) : (
            <p>{e.task}</p>
          )}
          <div className="flex items-baseline gap-1 t-small text-muted">
            <span className="shrink-0">Done when:</span>
            {custodian ? (
              <InlineEdit
                value={e.doneWhen}
                placeholder="How it will be known to be done"
                label="Done when"
                textClass="t-small"
                onSave={(v) => call(url, 'PATCH', { doneWhen: v })}
              />
            ) : (
              <span>{e.doneWhen}</span>
            )}
          </div>
          {lessonTitle && <p className="t-small text-muted">From the lesson “{lessonTitle}”</p>}

          {canProgress && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <select
                value={status}
                onChange={(ev) => call(url, 'PUT', { status: ev.target.value, note })}
                disabled={busy}
                aria-label="Your progress"
                className={FIELD}
              >
                {STUDY_PROGRESS.map((s) => (
                  <option key={s} value={s}>
                    {PROGRESS_LABEL[s]}
                  </option>
                ))}
              </select>
              <input
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                onBlur={() => note !== (mine?.note ?? '') && call(url, 'PUT', { status, note })}
                onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
                placeholder="A note on how it went"
                aria-label="Your note"
                maxLength={500}
                className={`${FIELD} min-w-0 flex-1`}
              />
            </div>
          )}
          {!canProgress && mine?.note && <p className="mt-1 t-small text-muted">Your note: {mine.note}</p>}

          {others.length > 0 && (
            <ul className="mt-1 space-y-0.5 t-small text-muted">
              {others.map((p) => (
                <li key={p.accountId}>
                  {p.name}: {PROGRESS_LABEL[p.status].toLowerCase()}
                  {p.note ? ` · “${p.note}”` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
        {custodian && (
          <span className="flex shrink-0 gap-2 t-small">
            <button onClick={() => call(url, 'PATCH', { move: 'up' })} disabled={busy} className={BUTTON} aria-label="Move up">
              ↑
            </button>
            <button onClick={() => call(url, 'PATCH', { move: 'down' })} disabled={busy} className={BUTTON} aria-label="Move down">
              ↓
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

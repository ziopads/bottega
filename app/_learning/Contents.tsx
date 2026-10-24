'use client';

import Link from 'next/link';

import { Section } from '@/app/_ui/layout';
import { lessonHref, type StudyGroup } from '@/lib/studyTypes';

// A study group's syllabus at a glance (REQUIREMENTS L-7), the outline on the
// left of the group's Syllabus tab and of each lesson: topics in order with
// their lessons, and how many of each topic's exercises the viewer has done.
// On a lesson the current one is marked and topics lead back to the group.

export default function Contents({ g, viewerId, lessonId }: { g: StudyGroup; viewerId: string; lessonId?: number }) {
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
              <a href={lessonId === undefined ? `#topic-${t.id}` : `/learning/${g.id}#topic-${t.id}`} className="flex items-baseline gap-2 hover:text-rust">
                <span className="t-num w-5 shrink-0 text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">{t.title}</span>
                {exercises.length > 0 && (
                  <span className={`t-num t-small ${done === exercises.length ? 'text-moss' : 'text-muted'}`}>
                    {done}/{exercises.length}
                  </span>
                )}
              </a>
              {lessons.length > 0 && (
                <ol className="ml-7 mt-0.5 space-y-0.5 t-small">
                  {lessons.map((l, j) => (
                    <li key={l.id}>
                      <Link
                        href={lessonHref(g.id, l.id)}
                        aria-current={l.id === lessonId ? 'page' : undefined}
                        className={`flex gap-2 hover:text-rust ${l.id === lessonId ? 'font-medium text-ink' : 'text-muted'}`}
                      >
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

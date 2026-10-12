import { notFound } from 'next/navigation';

import LessonView from '@/app/_learning/LessonView';
import { requireAccount } from '@/lib/access';
import { getGroup } from '@/lib/study';

// One lesson of a study group, for its members. Linked from the syllabus and
// from the connector's get_study_group.

export const metadata = { title: 'Lesson · Bottega' };

export default async function LessonPage({ params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { db, userId } = await requireAccount();
  const p = await params;
  const id = Number(p.id);
  const lessonId = Number(p.lessonId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(lessonId) || lessonId <= 0) notFound();
  const group = await getGroup(db, id);
  if (!group || !group.lessons.some((l) => l.id === lessonId)) notFound();
  return <LessonView initial={group} lessonId={lessonId} viewerId={userId} />;
}

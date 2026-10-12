import { notFound } from 'next/navigation';

import GroupView from '@/app/_learning/GroupView';
import { requireAccount } from '@/lib/access';
import { listModels } from '@/lib/gear';
import { getGroup } from '@/lib/study';
import { GROUP_TABS, type GroupTab } from '@/lib/studyTypes';

// One study group. Its contents are for members only (L-11): anyone else gets
// a 404, so the page does not say what the group holds. ?tab= opens a tab
// (syllabus, sessions, notes, resources, progress).

export const metadata = { title: 'Study group · Bottega' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> };

export default async function GroupPage({ params, searchParams }: Props) {
  const { db, userId } = await requireAccount();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const asked = (await searchParams).tab;
  const tab: GroupTab = (GROUP_TABS as readonly string[]).includes(asked ?? '') ? (asked as GroupTab) : 'syllabus';
  const [group, models] = await Promise.all([getGroup(db, id), listModels(db)]);
  if (!group) notFound();
  const approved = models
    .filter((m) => m.status === 'approved')
    .map((m) => ({ id: m.id, manufacturer: m.manufacturer, model: m.model }));
  return <GroupView initial={group} viewerId={userId} models={approved} initialTab={tab} />;
}

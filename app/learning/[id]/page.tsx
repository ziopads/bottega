import { notFound } from 'next/navigation';

import GroupView from '@/app/_learning/GroupView';
import { requireAccount } from '@/lib/access';
import { listModels } from '@/lib/gear';
import { getGroup } from '@/lib/study';

// One study group. Its contents are for members only (L-11): anyone else gets
// a 404, so the page does not say what the group holds.

export const metadata = { title: 'Study group · Bottega' };

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, userId } = await requireAccount();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [group, models] = await Promise.all([getGroup(db, id), listModels(db)]);
  if (!group) notFound();
  const approved = models
    .filter((m) => m.status === 'approved')
    .map((m) => ({ id: m.id, manufacturer: m.manufacturer, model: m.model }));
  return <GroupView initial={group} viewerId={userId} models={approved} />;
}

import { notFound } from 'next/navigation';

import ResourceView from '@/app/_learning/Resources';
import { requireAccount } from '@/lib/access';
import { getGroup } from '@/lib/study';

// One video or link of a study group, for its members: the video played in
// the page, the notes on it by moment. ?t=272 starts the video at 4:32
// (a note's moment, from elsewhere in the app).

export const metadata = { title: 'Resource · Bottega' };

type Props = { params: Promise<{ id: string; resourceId: string }>; searchParams: Promise<{ t?: string }> };

export default async function ResourcePage({ params, searchParams }: Props) {
  const { db, userId } = await requireAccount();
  const p = await params;
  const id = Number(p.id);
  const resourceId = Number(p.resourceId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(resourceId) || resourceId <= 0) notFound();
  const group = await getGroup(db, id);
  if (!group || !group.resources.some((r) => r.id === resourceId)) notFound();
  const t = Number((await searchParams).t);
  return <ResourceView initial={group} resourceId={resourceId} viewerId={userId} start={Number.isFinite(t) && t >= 0 ? t : null} />;
}

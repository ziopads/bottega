import LearningHome from '@/app/_learning/LearningHome';
import { requireAccount } from '@/lib/access';
import { listMyGroups } from '@/lib/study';

// Learning (REQUIREMENTS §10): the study groups the person belongs to, the
// invitations waiting for them, and starting a group.

export const metadata = { title: 'Learning · Bottega' };

export default async function LearningPage() {
  const { db } = await requireAccount();
  const { groups, invitations } = await listMyGroups(db);
  return <LearningHome groups={groups} invitations={invitations} />;
}

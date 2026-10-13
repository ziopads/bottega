import { notFound } from 'next/navigation';

import DocumentDetail from '@/app/_library/DocumentDetail';
import { requireAccount } from '@/lib/access';
import { getDocument } from '@/lib/documents';
import { listModels } from '@/lib/gear';
import { documentGroups } from '@/lib/study';

// One document (REQUIREMENTS §8). A document the person cannot see is a 404:
// its existence is not disclosed.

export const metadata = { title: 'Document · Bottega' };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, userId, isPlatformAdmin } = await requireAccount();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const doc = await getDocument(db, id);
  if (!doc) notFound();
  const models = doc.library
    ? (await listModels(db)).filter((m) => m.status === 'approved').map((m) => ({ id: m.id, manufacturer: m.manufacturer, model: m.model }))
    : [];
  const groups = (!doc.library && doc.level === 'owner') || (doc.library && doc.reviewStatus === 'approved') ? await documentGroups(db, id) : [];
  return <DocumentDetail initial={doc} viewerId={userId} isAdmin={isPlatformAdmin} models={models} groups={groups} />;
}

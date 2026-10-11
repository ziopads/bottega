import Library from '@/app/_library/Library';
import { requireAccount } from '@/lib/access';
import { getAllowance, listDocuments } from '@/lib/documents';

// The library and the person's own documents (REQUIREMENTS §8).

export const metadata = { title: 'Library · Bottega' };

export default async function LibraryPage() {
  const { db, userId, isPlatformAdmin } = await requireAccount();
  const [documents, allowance] = await Promise.all([listDocuments(db), getAllowance(db)]);
  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-serif text-2xl sm:text-3xl">Library</h1>
      <Library documents={documents} allowance={allowance} viewerId={userId} isAdmin={isPlatformAdmin} />
    </div>
  );
}

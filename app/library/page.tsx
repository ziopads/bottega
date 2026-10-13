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
      <div className="mb-6 flex flex-wrap items-baseline gap-4">
        <h1 className="t-title">Library</h1>
        <form action="/library/search" method="get" className="t-body ml-auto flex gap-2">
          <input name="q" placeholder="Search the manuals and books" aria-label="Search" className="w-64 rounded border border-line bg-card px-2 py-1 outline-none focus:border-rust" />
        </form>
      </div>
      <Library documents={documents} allowance={allowance} viewerId={userId} isAdmin={isPlatformAdmin} />
    </div>
  );
}

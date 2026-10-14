import Library from '@/app/_library/Library';
import { requireAccount } from '@/lib/access';
import { getAllowance, listDocuments } from '@/lib/documents';

// The library and the person's own documents (REQUIREMENTS §8), in tabs:
// Library (by type, then manufacturer and model), Your documents, Shared,
// Submissions. The tab, type and manufacturer are in the address
// (?tab=&type=&maker=); Library.tsx checks them.

export const metadata = { title: 'Library · Bottega' };

type Props = { searchParams: Promise<{ tab?: string; type?: string; maker?: string }> };

export default async function LibraryPage({ searchParams }: Props) {
  const { db, userId, isPlatformAdmin } = await requireAccount();
  const sp = await searchParams;
  const [documents, allowance] = await Promise.all([listDocuments(db), getAllowance(db)]);
  return (
    <Library
      documents={documents}
      allowance={allowance}
      viewerId={userId}
      isAdmin={isPlatformAdmin}
      initial={{ tab: sp.tab ?? '', type: sp.type ?? '', maker: sp.maker ?? '' }}
    />
  );
}

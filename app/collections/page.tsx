import Link from 'next/link';

import ReleaseList from '@/app/_studio/ReleaseList';
import { requireAccount } from '@/lib/access';
import { listArtists, listReleases } from '@/lib/studio';

// Collections (EP, LP, single, compilation, multi-part composition): the
// viewer's own first, then those shared with them (REQUIREMENTS AC-8).

export const metadata = { title: 'Collections · Bottega' };

export default async function CollectionsPage() {
  const { db, userId } = await requireAccount();
  const [releases, artists] = await Promise.all([listReleases(db), listArtists(db)]);
  return (
    <div>
      <Link href="/" className="t-body text-muted hover:text-rust">
        ← Projects
      </Link>
      <h1 className="mb-6 mt-2 t-title">Collections</h1>
      <ReleaseList initialReleases={releases} artists={artists} viewerId={userId} />
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';

import ReleaseList from '@/app/_studio/ReleaseList';
import { getStudioViewer, listArtists, listReleases } from '@/lib/studio';

// Collections (EP, LP, single, compilation, multi-part composition). Ported
// from Vivarium's /studio/releases.

export const metadata = { title: 'Collections · Bottega' };

export default async function CollectionsPage() {
  const viewer = await getStudioViewer();
  if (!viewer) redirect('/auth/denied');
  const [releases, artists] = await Promise.all([listReleases(), listArtists()]);
  return (
    <div>
      <Link href="/" className="text-sm text-muted hover:text-rust">
        ← Sessions
      </Link>
      <h1 className="mb-6 mt-2 font-serif text-2xl sm:text-3xl">Collections</h1>
      <ReleaseList initialReleases={releases} artists={artists} />
    </div>
  );
}

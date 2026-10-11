import Link from 'next/link';
import { notFound } from 'next/navigation';

import ReleaseDetail from '@/app/_studio/ReleaseDetail';
import { requireAccount } from '@/lib/access';
import { getRelease, listArtists, listProjects, listShares, releaseProjects } from '@/lib/studio';

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Params) {
  const id = parseId((await params).id);
  const { db } = await requireAccount();
  const release = id ? await getRelease(db, id).catch(() => null) : null;
  return { title: release ? release.title : 'Collection' };
}

export default async function CollectionPage({ params }: Params) {
  const { db } = await requireAccount();
  const id = parseId((await params).id);
  if (!id) notFound();
  const release = await getRelease(db, id);
  if (!release) notFound();
  const [tracks, artists, all, shares] = await Promise.all([
    releaseProjects(db, id),
    listArtists(db),
    listProjects(db),
    release.level === 'owner' ? listShares(db, { kind: 'project', id }) : Promise.resolve([]),
  ]);
  return (
    <div>
      <Link href="/collections" className="text-sm text-muted hover:text-rust">
        ← Collections
      </Link>
      <ReleaseDetail
        initialRelease={release}
        initialTracks={tracks}
        artists={artists.filter((a) => a.mine)}
        allSessions={all}
        initialShares={shares}
      />
    </div>
  );
}

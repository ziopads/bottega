import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import ReleaseDetail from '@/app/_studio/ReleaseDetail';
import { getRelease, getStudioViewer, listArtists, listProjects, releaseProjects } from '@/lib/studio';

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Params) {
  const id = parseId((await params).id);
  const release = id ? await getRelease(id).catch(() => null) : null;
  return { title: release ? release.title : 'Collection' };
}

export default async function CollectionPage({ params }: Params) {
  const viewer = await getStudioViewer();
  if (!viewer) redirect('/auth/denied');
  const id = parseId((await params).id);
  if (!id) notFound();
  const release = await getRelease(id);
  if (!release) notFound();
  const [tracks, artists, all] = await Promise.all([releaseProjects(id), listArtists(), listProjects()]);
  return (
    <div>
      <Link href="/collections" className="text-sm text-muted hover:text-rust">
        ← Collections
      </Link>
      <ReleaseDetail initialRelease={release} initialTracks={tracks} artists={artists} allSessions={all} />
    </div>
  );
}

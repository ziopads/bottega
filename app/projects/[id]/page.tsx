import Link from 'next/link';
import { notFound } from 'next/navigation';

import ProjectDetail from '@/app/_studio/ProjectDetail';
import { requireAccount } from '@/lib/access';
import {
  getProject,
  listArtists,
  listGenres,
  listNames,
  listNotes,
  listReferences,
  listShares,
  listTracks,
  releasesForProject,
} from '@/lib/studio';
import { audioConfigured } from '@/lib/studioAudio';

// One music project, as the signed-in person may see it: a project they can
// neither own nor see is not found (its existence is not disclosed).

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Params) {
  const id = parseId((await params).id);
  const { db } = await requireAccount();
  const project = id ? await getProject(db, id).catch(() => null) : null;
  if (!project) return { title: 'Bottega' };
  return { title: `${project.artist.code} ${project.canonicalId}${project.workingName ? ` — ${project.workingName}` : ''}` };
}

export default async function ProjectPage({ params }: Params) {
  const { db, userId } = await requireAccount();

  const id = parseId((await params).id);
  if (!id) notFound();
  const project = await getProject(db, id);
  if (!project) notFound();
  const isOwner = project.level === 'owner';

  const [tracks, names, artists, genres, notes, releases, references, shares] = await Promise.all([
    listTracks(db, id),
    listNames(db, id),
    listArtists(db),
    listGenres(db),
    listNotes(db, id),
    releasesForProject(db, id),
    listReferences(db, id),
    isOwner ? listShares(db, id) : Promise.resolve([]),
  ]);

  return (
    <div>
      <Link href="/" className="text-sm text-muted hover:text-rust">
        ← Sessions
      </Link>
      <ProjectDetail
        initialProject={project}
        initialTracks={tracks}
        names={names}
        artists={artists.filter((a) => a.mine)}
        initialGenres={genres}
        initialNotes={notes}
        initialReferences={references}
        releases={releases}
        viewerId={userId}
        initialShares={shares}
        uploadsEnabled={audioConfigured()}
      />
    </div>
  );
}

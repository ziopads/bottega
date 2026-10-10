import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import ProjectDetail from '@/app/_studio/ProjectDetail';
import {
  getProject,
  getStudioViewer,
  isAdmin,
  listArtists,
  listGenres,
  listNames,
  listNotes,
  listReferences,
  listTracks,
  releasesForProject,
} from '@/lib/studio';
import { audioConfigured } from '@/lib/studioAudio';

// One music project. Ported from Vivarium's /studio/[id].

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Params) {
  const id = parseId((await params).id);
  const project = id ? await getProject(id).catch(() => null) : null;
  if (!project) return { title: 'Bottega' };
  return { title: `${project.artist.code} ${project.canonicalId}${project.workingName ? ` — ${project.workingName}` : ''}` };
}

export default async function ProjectPage({ params }: Params) {
  const viewer = await getStudioViewer();
  if (!viewer) redirect('/auth/denied');

  const id = parseId((await params).id);
  if (!id) notFound();
  const project = await getProject(id);
  if (!project) notFound();

  const [tracks, names, artists, genres, notes, releases, references] = await Promise.all([
    listTracks(id),
    listNames(id),
    listArtists(),
    listGenres(),
    listNotes(id),
    releasesForProject(id),
    listReferences(id),
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
        artists={artists}
        initialGenres={genres}
        initialNotes={notes}
        initialReferences={references}
        releases={releases}
        viewerEmail={viewer.email}
        canDelete={isAdmin(viewer.email)}
        uploadsEnabled={audioConfigured()}
      />
    </div>
  );
}

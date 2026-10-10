import { redirect } from 'next/navigation';

import StudioProjects from '@/app/_studio/StudioProjects';
import { getMemberArtistId, getStudioViewer, listArtists, listGenres, listProjects, listReleases } from '@/lib/studio';

// Sessions: every music project, the home page. Ported from Vivarium's /studio.

export const metadata = { title: 'Sessions · Bottega' };

export default async function SessionsPage() {
  const viewer = await getStudioViewer();
  if (!viewer) redirect('/auth/denied');

  const [projects, artists, genres, releases, memberArtistId] = await Promise.all([
    listProjects(),
    listArtists(),
    listGenres(),
    listReleases(),
    getMemberArtistId(viewer.email),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl sm:text-3xl">Sessions</h1>
        <p className="text-sm text-muted">
          {projects.length} {projects.length === 1 ? 'session' : 'sessions'}
        </p>
      </div>
      <StudioProjects
        initialProjects={projects}
        artists={artists}
        initialGenres={genres}
        initialReleases={releases}
        defaultArtistId={memberArtistId}
      />
    </div>
  );
}

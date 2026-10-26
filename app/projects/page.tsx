import { listBoardPlaces, listFinishedIds } from '@/lib/board';

import StudioProjects from '@/app/_studio/StudioProjects';
import { getPreferences } from '@/lib/account';
import { requireAccount } from '@/lib/access';
import { listArtists, listGenres, listProjects, listReleases } from '@/lib/studio';

// Projects. One table of every project the person can see: their own and
// those other accounts have shared with them, with an Owner column and a
// filter between them (REQUIREMENTS AC-8). Shared rows play like any other;
// editing follows the access granted. The home page was this list until 23
// October; it is now the board (W-21).

export const metadata = { title: 'Projects · Bottega' };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { db, userId } = await requireAccount();
  const { show } = await searchParams;

  const [projects, artists, genres, releases, preferences, boardPlaces, finishedIds] = await Promise.all([
    listProjects(db),
    listArtists(db),
    listGenres(db),
    listReleases(db),
    getPreferences(db),
    listBoardPlaces(db),
    listFinishedIds(db),
  ]);
  const own = projects.filter((p) => p.ownerId === userId);
  const shared = projects.filter((p) => p.ownerId !== userId);
  const myArtists = artists.filter((a) => a.mine);
  // The artist chosen under Account › Preferences, else the first by code.
  const defaultArtist = myArtists.find((a) => a.id === preferences.defaultArtistId) ?? myArtists[0] ?? null;
  const myReleases = releases.filter((r) => r.ownerId === userId);

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="t-title">Projects</h1>
        <p className="t-body text-muted">
          {own.length} {own.length === 1 ? 'project' : 'projects'}
          {shared.length > 0 && ` · ${shared.length} shared with you`}
        </p>
      </div>
      <StudioProjects
        initialProjects={projects}
        artists={artists.filter((a) => a.creditable)}
        filterArtists={artists}
        initialGenres={genres}
        initialReleases={myReleases}
        defaultArtistId={defaultArtist?.id ?? null}
        boardPlaces={boardPlaces}
        finishedIds={finishedIds}
        initialFinishedOnly={show === 'finished'}
        initialColumns={preferences.projectColumns}
      />
    </div>
  );
}

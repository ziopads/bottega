import Link from 'next/link';

import StudioProjects from '@/app/_studio/StudioProjects';
import { getPreferences } from '@/lib/account';
import { requireAccount } from '@/lib/access';
import { listArtists, listGenres, listProjects, listReleases } from '@/lib/studio';
import { formatDuration, type AccessLevel } from '@/lib/studioTypes';

// Projects. The signed-in person's own projects first, with the full list
// tools; below them, projects other accounts have shared with them, each
// naming its owner and the access granted (REQUIREMENTS AC-8). The home page
// was this list until 23 October; it is now the board (W-21).

export const metadata = { title: 'Projects · Bottega' };

const LEVEL_WORD: Record<AccessLevel, string> = {
  owner: 'owner',
  edit: 'can edit',
  contribute: 'can contribute',
  view: 'can listen',
};

export default async function ProjectsPage() {
  const { db, userId } = await requireAccount();

  const [projects, artists, genres, releases, preferences] = await Promise.all([
    listProjects(db),
    listArtists(db),
    listGenres(db),
    listReleases(db),
    getPreferences(db),
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
        </p>
      </div>
      <StudioProjects
        initialProjects={own}
        artists={artists.filter((a) => a.creditable)}
        initialGenres={genres}
        initialReleases={myReleases}
        defaultArtistId={defaultArtist?.id ?? null}
      />

      {shared.length > 0 && (
        <section className="mt-12">
          <h2 className="t-label mb-3 border-b border-line pb-1">Shared with me</h2>
          <ul className="divide-y divide-line border-y border-line t-body">
            {shared.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
                <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 hover:text-rust">
                  <span className="font-mono text-[11px] text-muted">
                    {p.artist.code} {p.canonicalId}
                  </span>{' '}
                  {p.workingName || <span className="text-muted">untitled</span>}
                </Link>
                <span className="text-[11px] text-muted">{formatDuration(p.latest?.durationS ?? null)}</span>
                <span className="text-[11px] text-muted">
                  {p.ownerName} · {LEVEL_WORD[p.level]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

import Link from 'next/link';

import StudioProjects from '@/app/_studio/StudioProjects';
import { requireAccount } from '@/lib/access';
import { listArtists, listGenres, listProjects, listReleases } from '@/lib/studio';
import { formatDuration, type AccessLevel } from '@/lib/studioTypes';

// Sessions, the home page. The signed-in person's own sessions first, with
// the full list tools; below them, sessions other accounts have shared with
// them, each naming its owner and the access granted (REQUIREMENTS AC-8).

export const metadata = { title: 'Sessions · Bottega' };

const LEVEL_WORD: Record<AccessLevel, string> = {
  owner: 'owner',
  edit: 'can edit',
  contribute: 'can contribute',
  view: 'can listen',
};

export default async function SessionsPage() {
  const { db, userId } = await requireAccount();

  const [projects, artists, genres, releases] = await Promise.all([
    listProjects(db),
    listArtists(db),
    listGenres(db),
    listReleases(db),
  ]);
  const own = projects.filter((p) => p.ownerId === userId);
  const shared = projects.filter((p) => p.ownerId !== userId);
  const myArtists = artists.filter((a) => a.mine);
  const myReleases = releases.filter((r) => r.ownerId === userId);

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl sm:text-3xl">Sessions</h1>
        <p className="text-sm text-muted">
          {own.length} {own.length === 1 ? 'session' : 'sessions'}
        </p>
      </div>
      <StudioProjects
        initialProjects={own}
        artists={myArtists}
        initialGenres={genres}
        initialReleases={myReleases}
        defaultArtistId={myArtists[0]?.id ?? null}
      />

      {shared.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-xs uppercase tracking-wide text-muted">Shared with me</h2>
          <ul className="divide-y divide-line border-y border-line text-sm">
            {shared.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
                <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 hover:text-rust">
                  <span className="font-mono text-xs text-muted">
                    {p.artist.code} {p.canonicalId}
                  </span>{' '}
                  {p.workingName || <span className="text-muted">untitled</span>}
                </Link>
                <span className="text-xs text-muted">{formatDuration(p.latest?.durationS ?? null)}</span>
                <span className="text-xs text-muted">
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

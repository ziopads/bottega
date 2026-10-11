import Link from 'next/link';
import { notFound } from 'next/navigation';

import ProjectDetail from '@/app/_studio/ProjectDetail';
import { SESSION_TABS, type SessionTab } from '@/lib/sessionTabs';
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

type Params = { params: Promise<{ id: string }>; searchParams?: Promise<{ tab?: string }> };

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

export default async function ProjectPage({ params, searchParams }: Params) {
  const { db, userId } = await requireAccount();

  const id = parseId((await params).id);
  if (!id) notFound();
  const project = await getProject(db, id);
  if (!project) notFound();
  const isOwner = project.level === 'owner';
  const asked = (await searchParams)?.tab;
  const tab: SessionTab = SESSION_TABS.includes(asked as SessionTab) ? (asked as SessionTab) : 'overview';

  const [tracks, names, artists, genres, notes, releases, references, shares] = await Promise.all([
    listTracks(db, id),
    listNames(db, id),
    listArtists(db),
    listGenres(db),
    listNotes(db, id),
    releasesForProject(db, id),
    listReferences(db, id),
    isOwner ? listShares(db, { kind: 'project', id }) : Promise.resolve([]),
  ]);

  return (
    <div>
      <Link href="/" className="t-body text-muted hover:text-ink">
        ← Sessions
      </Link>
      <ProjectDetail
        initialTab={tab}
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

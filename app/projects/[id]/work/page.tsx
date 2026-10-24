import { notFound } from 'next/navigation';

import WorkPanel from '@/app/_studio/WorkPanel';
import { requireAccount } from '@/lib/access';
import { listSnapshotMeta } from '@/lib/als/store';
import { listWorkSessions } from '@/lib/sessions';
import { getProject } from '@/lib/studio';
import { getWorkflow } from '@/lib/workflow';

// The working panel (REQUIREMENTS W-41): opened from a project's header in a
// narrow window of its own, to sit beside Live. The site's header is hidden
// here to leave the room to the panel; the player bar stays.

export const metadata = { title: 'Working · Bottega' };

type Params = { params: Promise<{ id: string }> };

export default async function WorkPage({ params }: Params) {
  const { db } = await requireAccount();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const project = await getProject(db, id);
  if (!project) notFound();
  const [workflow, sessions, saves] = await Promise.all([getWorkflow(db, id), listWorkSessions(db, id, 5, 1), listSnapshotMeta(db, id)]);
  const level = project.level;
  return (
    <>
      {/* This page lives in a narrow window beside Live: the site's navigation would only crowd it. */}
      <style>{'body > header { display: none; }'}</style>
      <WorkPanel
        projectId={id}
        title={`${project.workingName || 'untitled'} · ${project.artist.code} ${project.canonicalId}`}
        initialWorkflow={workflow}
        initialFeed={{ sessions, saves: saves.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, 10) }}
        canContribute={level === 'owner' || level === 'edit' || level === 'contribute'}
        canEdit={level === 'owner' || level === 'edit'}
      />
    </>
  );
}

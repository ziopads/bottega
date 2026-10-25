'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '@/app/_studio/controls';
import WhereItStands, { openWorkPanel } from '@/app/_studio/WhereItStands';
import { BUTTON } from '@/app/_ui/styles';
import type { BoardProject } from '@/lib/boardTypes';
import type { WorkSession } from '@/lib/sessionTypes';
import type { Workflow } from '@/lib/workflowTypes';

// The board's right-hand side (25 October, after the rack and channel strip
// of the Finish Line prototype): the project chosen in the rotation rack,
// with the same summary as its Overview (Where it stands), loaded when it is
// chosen. To-dos can be started, done and made next from here; the rack
// refreshes after each change.

type Loaded = { id: number; workflow: Workflow; sessions: WorkSession[] };

export default function BoardDetail({
  project,
  busy,
  onBack,
  onChanged,
}: {
  project: BoardProject;
  busy: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ workflow: Workflow }>(`/api/projects/${project.id}/workflow`, { method: 'GET' }),
      api<{ sessions: WorkSession[] }>(`/api/projects/${project.id}/sessions`, { method: 'GET' }),
    ]).then(([w, s]) => {
      if (!live) return;
      if (!w.ok) {
        setError(w.body?.error || 'Could not load this project.');
        return;
      }
      setError('');
      setData({ id: project.id, workflow: w.data.workflow, sessions: s.ok ? s.data.sessions : [] });
    });
    return () => {
      live = false;
    };
  }, [project.id]);

  const shown = data && data.id === project.id ? data : null;

  return (
    <section aria-label={`${project.title}: where it stands`} className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="t-num t-small text-muted">
            {project.code}
            {project.bpm ? ` · ${project.bpm} BPM` : ''}
            {project.ownerName ? ` · ${project.ownerName}` : ''}
          </p>
          <h2 className="t-title">
            <Link href={`/projects/${project.id}`} className="hover:text-rust">
              {project.title}
            </Link>
          </h2>
        </div>
        <span className="flex flex-wrap gap-1.5">
          <Link href={`/projects/${project.id}`} className={BUTTON}>
            Open project
          </Link>
          <button type="button" onClick={() => openWorkPanel(project.id)} className={BUTTON} title="Opens a narrow window to keep beside Live">
            Working session ↗
          </button>
          <button type="button" onClick={onBack} disabled={busy} className={BUTTON} title="Back to the backlog">
            ↓ Backlog
          </button>
        </span>
      </div>
      {error && <p className="t-body text-rust">{error}</p>}
      {!shown && !error && <p className="t-body text-muted">Loading…</p>}
      {shown && (
        <WhereItStands
          projectId={project.id}
          workflow={shown.workflow}
          setWorkflow={(w) => {
            setData({ ...shown, workflow: w });
            onChanged();
          }}
          sessions={shown.sessions}
          mixUploadedAt={null}
          canContribute={project.canContribute}
          onTab={(tab) => router.push(`/projects/${project.id}?tab=${tab}`)}
        />
      )}
    </section>
  );
}

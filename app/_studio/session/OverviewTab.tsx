'use client';

import Link from 'next/link';

import { GenreSelect, InlineEdit } from '@/app/_studio/controls';
import { formatMoment, mixMarkers } from '@/app/_studio/Notes';
import Sharing from '@/app/_studio/Sharing';
import WhereItStands from '@/app/_studio/WhereItStands';
import Player from '@/app/_ui/audio/Player';
import { DetailGrid, MetaList, Section } from '@/app/_ui/layout';
import type { StudioName, StudioNote, StudioProject, StudioRelease, StudioShare, StudioTrack } from '@/lib/studioTypes';
import { formatDuration } from '@/lib/studioTypes';
import type { WorkSession } from '@/lib/sessionTypes';
import type { Workflow } from '@/lib/workflowTypes';

import { formatDate } from './audioUpload';
import { TEXT_LINK } from '@/app/_ui/styles';

// The Overview tab (REQUIREMENTS S-1, S-2, W-39): where the project stands,
// the current mix to play, the latest notes; to their left, its details and who it
// is shared with.

export default function OverviewTab({
  project,
  current,
  versions,
  notes,
  pastNames,
  releases,
  genres,
  canEdit,
  isOwner,
  initialShares,
  onPatch,
  onAddGenre,
  onLength,
  onTab,
  workflow,
  setWorkflow,
  sessions,
  canContribute,
  setKey,
}: {
  project: StudioProject;
  current: StudioTrack | null;
  versions: number;
  notes: StudioNote[];
  pastNames: StudioName[];
  releases: StudioRelease[];
  genres: string[];
  canEdit: boolean;
  isOwner: boolean;
  initialShares: StudioShare[];
  onPatch: (fields: Record<string, unknown>) => Promise<boolean>;
  onAddGenre: (name: string) => Promise<string | null>;
  onLength: (id: number, seconds: number) => void;
  onTab: (key: string) => void;
  workflow: Workflow;
  setWorkflow: (w: Workflow) => void;
  /** The latest sessions read from saved sets (W-39). */
  sessions: WorkSession[];
  canContribute: boolean;
  /** The key of the newest saved set: undefined when no set (or none read with keys) is stored, null when it has none. */
  setKey: string | null | undefined;
}) {
  const latest = notes.slice(0, 4);
  const markers = current ? mixMarkers(notes, workflow.cards, current.id) : [];

  const main = (
    <>
      <WhereItStands
        projectId={project.id}
        workflow={workflow}
        setWorkflow={setWorkflow}
        sessions={sessions}
        mixUploadedAt={current?.uploadedAt ?? null}
        canContribute={canContribute}
        onTab={onTab}
      />

      <Section
        label={current ? `Current mix · ${current.label}` : 'Current mix'}
        action={
          versions > 0 && (
            <button onClick={() => onTab('mixes')} className={TEXT_LINK}>
              All {versions} {versions === 1 ? 'version' : 'versions'} →
            </button>
          )
        }
      >
        {current ? (
          <>
            <p className="t-body mb-2 truncate text-muted" title={current.originalFilename}>
              {current.originalFilename}
            </p>
            <Player
              item={{
                trackId: current.id,
                projectId: project.id,
                code: `${project.artist.code} ${project.canonicalId}`,
                title: project.workingName,
                label: current.label,
                kind: 'mix',
                variant: current.variant,
                durationS: current.durationS,
              }}
              peaks={current.peaks}
              durationS={current.durationS}
              markers={markers}
              height={56}
              onDuration={(s) => onLength(current.id, s)}
            />
          </>
        ) : (
          <p className="t-body text-muted">
            No mixes yet.{' '}
            <button onClick={() => onTab('mixes')} className="underline hover:text-ink">
              Add the first
            </button>
            .
          </p>
        )}
      </Section>

      <Section
        label="Latest notes"
        action={
          notes.length > 0 && (
            <button onClick={() => onTab('notes')} className={TEXT_LINK}>
              All {notes.length} →
            </button>
          )
        }
      >
        {latest.length === 0 ? (
          <p className="t-body text-muted">No notes yet.</p>
        ) : (
          <ul className="t-body divide-y divide-line">
            {latest.map((n) => (
              <li key={n.id} className="py-2">
                <div className="flex gap-2 t-small text-muted">
                  {n.positionS !== null && <span className="t-num font-medium text-ink">{formatMoment(n.positionS)}</span>}
                  <span className="font-medium text-ink">{n.authorName}</span>
                  {n.trackLabel !== null && <span>{n.trackLabel}</span>}
                  <span>{formatDate(n.createdAt)}</span>
                </div>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );

  const aside = (
    <>
      <Section label="Details">
        <MetaList
          rows={[
            {
              label: 'Genre',
              value: canEdit ? (
                <GenreSelect value={project.genre} genres={genres} onAddGenre={onAddGenre} onChange={(g) => onPatch({ genre: g })} />
              ) : (
                project.genre || '—'
              ),
            },
            {
              label: 'BPM',
              value: canEdit ? (
                <span className="t-num">
                  <InlineEdit
                    value={project.bpm === null ? '' : String(project.bpm)}
                    placeholder="—"
                    label="BPM"
                    inputMode="decimal"
                    onSave={(v) => onPatch({ bpm: v })}
                  />
                </span>
              ) : (
                <span className="t-num">{project.bpm ?? '—'}</span>
              ),
            },
            {
              label: 'Key',
              value: setKey ? (
                <span title="From the newest saved set; change it in Live">{setKey}</span>
              ) : (
                <span className="text-muted">{setKey === undefined ? 'Drop the project folder on the State tab' : '—'}</span>
              ),
            },
            { label: 'Length', value: <span className="t-num">{formatDuration(current?.durationS ?? null) || '—'}</span> },
            { label: 'Versions', value: <span className="t-num">{versions}</span> },
            { label: 'Started', value: <span className="t-num">{formatDate(project.createdAt)}</span> },
            ...(releases.length
              ? [
                  {
                    label: 'On',
                    value: releases.map((r, i) => (
                      <span key={r.id}>
                        {i > 0 && ', '}
                        <Link href={`/collections/${r.id}`} className="hover:underline">
                          {r.title}
                        </Link>
                      </span>
                    )),
                  },
                ]
              : []),
            ...(pastNames.length
              ? [
                  {
                    label: 'Earlier names',
                    value: (
                      <ul>
                        {pastNames.map((n, i) => (
                          <li key={i}>
                            {n.name} <span className="t-small text-muted">{formatDate(n.setAt)}</span>
                          </li>
                        ))}
                      </ul>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>
      {isOwner && (
        <Section label="Shared with">
          <Sharing sharesUrl={`/api/projects/${project.id}/shares`} initialShares={initialShares} bare />
        </Section>
      )}
    </>
  );

  return <DetailGrid main={main} aside={aside} side="left" />;
}

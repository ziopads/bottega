'use client';

import Link from 'next/link';

import { GenreSelect, InlineEdit } from '@/app/_studio/controls';
import { formatMoment } from '@/app/_studio/Notes';
import Sharing from '@/app/_studio/Sharing';
import Player from '@/app/_ui/audio/Player';
import { DetailGrid, MetaList, Section } from '@/app/_ui/layout';
import type { StudioName, StudioNote, StudioProject, StudioRelease, StudioShare, StudioTrack } from '@/lib/studioTypes';
import { formatDuration } from '@/lib/studioTypes';
import type { Workflow } from '@/lib/workflowTypes';

import { audioUrl, formatDate } from './audioUpload';

// The Overview tab (REQUIREMENTS S-1, S-2): the current mix to play, where
// the session stands, the latest notes; to their left, its details and who it
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
}) {
  const latest = notes.slice(0, 4);
  const stageLabel = workflow.stages.find((x) => x.key === workflow.stage)?.label ?? '';
  const criteria = workflow.criteria.filter((c) => c.stage === workflow.stage && c.reviewed && !c.rejected);
  const openCards = workflow.cards.filter(
    (c) => c.stage === workflow.stage && !c.settled && (c.status === 'accepted' || c.status === 'in progress'),
  );
  const proposals = workflow.cards.filter((c) => c.status === 'proposed').length + workflow.criteria.filter((c) => !c.reviewed).length;
  const markers = current
    ? notes
        .filter((n) => n.trackId === current.id && n.positionS !== null)
        .map((n) => ({ id: n.id, at: n.positionS!, label: `${formatMoment(n.positionS!)} · ${n.body.slice(0, 60)}` }))
    : [];

  const main = (
    <>
      <Section
        label={current ? `Current mix · ${current.label}` : 'Current mix'}
        action={
          versions > 0 && (
            <button onClick={() => onTab('mixes')} className="text-muted hover:text-ink">
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
              src={audioUrl(current)}
              peaks={current.peaks}
              durationS={current.durationS}
              markers={markers}
              height={56}
              preload="metadata"
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
        label={stageLabel ? `Where it stands · ${stageLabel}` : 'Where it stands'}
        action={
          <button onClick={() => onTab('workflow')} className="text-muted hover:text-ink">
            Workflow →
          </button>
        }
      >
        {workflow.stage ? (
          <div className="t-body space-y-1">
            <p>
              {criteria.length === 0
                ? 'No exit criteria written for this stage yet.'
                : `${criteria.filter((c) => c.metAt).length} of ${criteria.length} exit criteria met.`}{' '}
              {openCards.length} open {openCards.length === 1 ? 'card' : 'cards'}
              {proposals > 0 ? `, ${proposals} proposed by Claude` : ''}.
            </p>
            {criteria.filter((c) => !c.metAt).slice(0, 3).map((c) => (
              <p key={c.id} className="text-muted">
                ☐ {c.body}
              </p>
            ))}
          </div>
        ) : (
          <p className="t-body text-muted">
            The workflow has not been started.{' '}
            <button onClick={() => onTab('workflow')} className="underline hover:text-ink">
              Start it
            </button>
          </p>
        )}
      </Section>

      <Section
        label="Latest notes"
        action={
          notes.length > 0 && (
            <button onClick={() => onTab('notes')} className="text-muted hover:text-ink">
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
                <div className="flex gap-2 text-[11px] text-muted">
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
                            {n.name} <span className="text-[11px] text-muted">{formatDate(n.setAt)}</span>
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

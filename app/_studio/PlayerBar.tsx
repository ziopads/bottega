'use client';

import Link from 'next/link';
import type { StudioProject } from '@/lib/studioTypes';
import { formatDuration } from '@/lib/studioTypes';
import VolumeControl from '@/app/_ui/audio/VolumeControl';
import { Stars } from './controls';

// The list page's one shared player, fixed to the bottom of the window.
// Presentational: the <audio> element and the queue logic live in
// StudioProjects, which owns what "next" means (the filtered, sorted list).

export default function PlayerBar({
  project,
  playing,
  time,
  duration,
  autoAdvance,
  onToggle,
  onPrev,
  onNext,
  onSeek,
  onRate,
  onAutoAdvance,
}: {
  project: StudioProject;
  playing: boolean;
  time: number;
  duration: number;
  autoAdvance: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (t: number) => void;
  /** Omit to hide the stars (the collection page plays, it doesn't rate). */
  onRate?: (n: number) => void;
  onAutoAdvance: (on: boolean) => void;
}) {
  const btn = 'flex h-8 w-8 items-center justify-center rounded-full border border-line hover:border-ink';
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-parchment/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <button onClick={onPrev} className={btn} aria-label="Previous project" title="Previous (P)">
            ‹
          </button>
          <button
            onClick={onToggle}
            className={`${btn} h-10 w-10 bg-ink text-parchment hover:bg-ink/80`}
            aria-label={playing ? 'Pause' : 'Play'}
            title="Play / pause (Space)"
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button onClick={onNext} className={btn} aria-label="Next project" title="Next (N)">
            ›
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-xs font-medium tracking-[0.04em] text-muted">{project.artist.code}</span>
            <Link href={`/projects/${project.id}`} className="font-mono hover:underline">
              {project.canonicalId}
            </Link>
            <span className="truncate">{project.workingName}</span>
            {project.latest && <span className="text-xs text-muted">{project.latest.label}</span>}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs tabular-nums text-muted">
            <span className="w-10 text-right">{formatDuration(time)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(time, duration || 0)}
              onChange={(e) => onSeek(Number(e.target.value))}
              aria-label="Position"
              className="h-1 flex-1 accent-ink"
            />
            <span className="w-10">{formatDuration(duration || null)}</span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted">
          {onRate && (
            <span title="Rate the playing session (1–5, 0 clears)">
              <Stars rating={project.rating} onRate={onRate} />
            </span>
          )}
          <VolumeControl />
          <label className="flex items-center gap-1" title="Play the next project when this one ends">
            <input type="checkbox" checked={autoAdvance} onChange={(e) => onAutoAdvance(e.target.checked)} />
            continue
          </label>
        </div>
      </div>
    </div>
  );
}

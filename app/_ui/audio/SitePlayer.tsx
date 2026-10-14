'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Stars } from '@/app/_studio/controls';
import { BUTTON } from '@/app/_ui/styles';
import { formatDuration } from '@/lib/studioTypes';

import { currentTime, element, mixHref, seek, setAutoAdvance, step, stop, toggle, useDeck, useDeckTime } from './deck';
import { applyVolume, useVolume } from './volume';
import VolumeControl from './VolumeControl';

// The bar at the foot of every page while something plays (REQUIREMENTS
// S-17): the site's one player (deck.ts), mounted once in the root layout so
// it survives moving between pages. The session and mix link back to the mix
// on its session page; "Note at 1:35" opens that page with the note box
// ready at the moment the button was pressed, and the sound carries on.
// Keys anywhere, outside a field: Space plays and pauses, N and P step
// through the queue, 1–5 rate the playing session where the page offers it
// (the sessions list), 0 clears.

function typingInField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName));
}

export default function SitePlayer() {
  const router = useRouter();
  const deck = useDeck();
  const { item, queue, playing, duration, autoAdvance, error, rater } = deck;
  const time = useDeckTime(!!item);
  const { level, muted } = useVolume();
  useEffect(() => applyVolume(element(), { level, muted }), [level, muted]);

  useEffect(() => {
    if (!item) return;
    function onKey(e: KeyboardEvent) {
      if (typingInField(e) || e.metaKey || e.ctrlKey || e.altKey || !item) return;
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'n' || e.key === 'N') step(1);
      else if (e.key === 'p' || e.key === 'P') step(-1);
      else if (rater && /^[0-5]$/.test(e.key)) rater.rate(item.projectId, Number(e.key));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, rater]);

  if (!item) return null;
  const btn = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line hover:border-ink disabled:opacity-30';
  const several = queue.length > 1;
  const at = Math.round(time * 10) / 10;

  return (
    <>
      {/* Room at the foot of the page, so the bar never covers its end. */}
      <div aria-hidden className="h-24" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-parchment/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => step(-1)} disabled={!several} className={btn} aria-label="Previous" title="Previous (P)">
              ‹
            </button>
            <button
              onClick={() => toggle()}
              className={`${btn} h-10 w-10 bg-ink text-parchment hover:bg-ink/80`}
              aria-label={playing ? 'Pause' : 'Play'}
              title="Play / pause (Space)"
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <button onClick={() => step(1)} disabled={!several} className={btn} aria-label="Next" title="Next (N)">
              ›
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <div className="t-body flex items-baseline gap-2">
              <Link href={mixHref(item)} className="min-w-0 truncate hover:text-rust" title="Open this mix on its session page">
                <span className="font-mono">{item.code}</span>
                {item.title && <span className="ml-2">{item.title}</span>}
                <span className="ml-2 text-[11px] text-muted">{item.kind === 'reference' ? `reference · ${item.label}` : item.label}</span>
              </Link>
              {error && <span className="text-[11px] text-rust">{error}</span>}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums text-muted">
              <span className="w-10 text-right">{formatDuration(time) || '0:00'}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(time, duration || 0)}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Position"
                className="h-1 flex-1 accent-ink"
              />
              <span className="w-10">{formatDuration(duration || null) || '—'}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-muted">
            {item.kind === 'mix' && (
              <button
                onClick={() => router.push(mixHref(item, Math.round(currentTime() * 10) / 10))}
                className={BUTTON}
                title="Open the mix with a note at this moment"
              >
                Note at {formatDuration(at) || '0:00'}
              </button>
            )}
            {rater && (
              <span title="Rate the playing session (1–5, 0 clears)">
                <Stars rating={rater.ratingOf(item.projectId)} onRate={(n) => rater.rate(item.projectId, n)} />
              </span>
            )}
            <VolumeControl />
            {several && (
              <label className="flex items-center gap-1" title="Play the next one when this one ends">
                <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
                continue
              </label>
            )}
            <button onClick={stop} className="px-1 text-base leading-none hover:text-ink" aria-label="Stop and close the player" title="Stop">
              ×
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

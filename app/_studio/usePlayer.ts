'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioProject } from '@/lib/studioTypes';

// One shared <audio> element that plays sessions' newest reference tracks and
// steps through a queue: the sessions list as sorted and filtered, or a
// release's running order. Used by the sessions list and the release page.

export function audioSrc(p: StudioProject): string | null {
  return p.latest ? `/api/tracks/${p.latest.trackId}/audio` : null;
}

/** Keys typed into a field belong to the field, not the player. */
function typingInField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function usePlayer(queue: StudioProject[], all: StudioProject[], onRateKey?: (p: StudioProject, n: number) => void) {
  const audio = useRef<HTMLAudioElement>(null);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const current = all.find((p) => p.id === currentId) ?? null;

  const start = useCallback((p: StudioProject) => {
    const el = audio.current;
    const src = audioSrc(p);
    if (!el || !src) return;
    setCurrentId(p.id);
    setTime(0);
    setDuration(p.latest?.durationS ?? 0);
    el.src = src;
    el.play().catch(() => setPlaying(false));
  }, []);

  const toggle = useCallback(
    (p?: StudioProject) => {
      const el = audio.current;
      if (!el) return;
      if (p && p.id !== currentId) return start(p);
      if (currentId === null) {
        const first = queue.find((x) => x.latest);
        if (first) start(first);
        return;
      }
      if (el.paused) el.play().catch(() => setPlaying(false));
      else el.pause();
    },
    [currentId, queue, start],
  );

  // Next and previous walk the queue, skipping sessions with no audio.
  const step = useCallback(
    (dir: 1 | -1) => {
      const playable = queue.filter((p) => p.latest);
      if (!playable.length) return;
      const i = playable.findIndex((p) => p.id === currentId);
      start(i < 0 ? playable[0] : playable[(i + dir + playable.length) % playable.length]);
    },
    [queue, currentId, start],
  );

  const seek = useCallback((t: number) => {
    if (audio.current) audio.current.currentTime = t;
    setTime(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (typingInField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        // Leave Space to scroll the page when there is nothing to play.
        if (currentId === null && !queue.some((p) => p.latest)) return;
        e.preventDefault();
        toggle();
      } else if (e.key === 'n' || e.key === 'N') step(1);
      else if (e.key === 'p' || e.key === 'P') step(-1);
      else if (current && onRateKey && /^[0-5]$/.test(e.key)) onRateKey(current, Number(e.key));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, step, current, currentId, queue, onRateKey]);

  const audioProps = {
    ref: audio,
    preload: 'none' as const,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLAudioElement>) => setTime(e.currentTarget.currentTime),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const d = e.currentTarget.duration;
      if (Number.isFinite(d)) setDuration(d);
    },
    onEnded: () => (autoAdvance ? step(1) : setPlaying(false)),
  };

  return { audioProps, current, currentId, playing, time, duration, autoAdvance, setAutoAdvance, toggle, step, seek };
}

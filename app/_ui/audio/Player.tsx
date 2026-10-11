'use client';

import { useEffect, useImperativeHandle, useRef, useState } from 'react';

import { formatDuration } from '@/lib/studioTypes';

import { applyVolume, useVolume } from './volume';
import Waveform, { type Marker } from './Waveform';

// The app's player (REQUIREMENTS S-10): one slim row, a play button, the time,
// the waveform to scrub, and the length. Volume is the app's (S-12). One
// player sounds at a time on a page: starting one pauses the others.

export type PlayerHandle = {
  seek: (seconds: number, play?: boolean) => void;
  currentTime: () => number;
  playing: () => boolean;
};

const live = new Set<HTMLAudioElement>();

export default function Player({
  src,
  peaks,
  durationS,
  markers,
  height = 40,
  preload = 'none',
  ref,
  onTime,
  onDuration,
  onMarker,
}: {
  src: string;
  peaks: number[] | null;
  durationS: number | null;
  markers?: Marker[];
  height?: number;
  preload?: 'none' | 'metadata';
  ref?: React.Ref<PlayerHandle>;
  /** While playing, a few times a second: for notes that stamp the moment. */
  onTime?: (seconds: number) => void;
  /** The length, once the file reports it (for files with none on record). */
  onDuration?: (seconds: number) => void;
  onMarker?: (m: Marker) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(durationS);
  const { level, muted } = useVolume();
  useEffect(() => applyVolume(audio.current, { level, muted }), [level, muted]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    live.add(el);
    return () => {
      live.delete(el);
    };
  }, []);

  function seek(seconds: number, play = false) {
    const el = audio.current;
    if (!el) return;
    const go = () => {
      el.currentTime = seconds;
      setTime(seconds);
      if (play) void el.play();
    };
    // A file with preload="none" has to load before it can seek.
    if (el.readyState >= 1) go();
    else {
      el.addEventListener('loadedmetadata', go, { once: true });
      el.load();
    }
  }

  useImperativeHandle(ref, () => ({
    seek,
    currentTime: () => audio.current?.currentTime ?? 0,
    playing: () => !!audio.current && !audio.current.paused,
  }));

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  const progress = duration ? Math.min(1, time / duration) : 0;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] text-parchment hover:bg-ink/80"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="t-num w-10 shrink-0 text-right text-[11px] text-muted">{formatDuration(time) || '0:00'}</span>
      <div className="min-w-0 flex-1">
        <Waveform
          peaks={peaks}
          progress={progress}
          duration={duration}
          markers={markers}
          height={height}
          onSeek={(f) => duration && seek(f * duration, true)}
          onMarker={onMarker}
        />
      </div>
      <span className="t-num w-10 shrink-0 text-[11px] text-muted">{formatDuration(duration) || '—'}</span>
      <audio
        ref={audio}
        src={src}
        preload={preload}
        onPlay={(e) => {
          live.forEach((a) => a !== e.currentTarget && a.pause());
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          onTime?.(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setDuration(d);
            if (durationS === null) onDuration?.(d);
          }
        }}
      />
    </div>
  );
}
